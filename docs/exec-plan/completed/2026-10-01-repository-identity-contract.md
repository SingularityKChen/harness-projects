# 仓库外部身份契约 ExecPlan

> 状态：Completed（2026-10-02）：实现、验证、独立验收与第一轮 MVP 评审修订完成，已获批准并按人类授权 rebase merge；合并回执以 `gh pr view 251 -R SingularityKChen/harness-projects --json mergedAt,mergeCommit` 回读为准。
> 创建：2026-10-01；时区：Asia/Shanghai（CST）。
> 规范：根 `PLANS.md`；范围：#195 的 repository 身份、运行时拒绝与可恢复升级。Superseded by Decision Log「按 D10 订正」（2026-10-01）：「可恢复升级」已移出范围。
> 迭代：迭代 4 · Demo I：插件骨架、装配前置与 GitHub 读取，2026-10-08 至 2026-10-14。

## Purpose / Big Picture

实施完成后，core 可以经 Storage 端口登记 repository 外部身份，并在 fake 与 SQLite 中读回同一稳定身份。已有合法本地库升级后继续保留实体、仓库、执行上下文及运行的引用；未知 kind 不会被登记成 issue。最小成功证据是两实现的同一契约用例，以及一个带真实关联行的 v5 文件升级、关句柄、重新打开后的逐表比较。Superseded by Decision Log「按 D10 订正」（2026-10-01）：「已有合法本地库升级后继续保留…引用」与「v5 文件升级、关句柄、重新打开后的逐表比较」两处作废，首发前没有需保住的库；最小成功证据改为两实现的同一契约用例与 002 CHECK 的显式 `repository` 正控，见 `Validation and Acceptance`。

这是后续 Start Work 注册仓库的前置契约，独立关闭 [#195](https://github.com/SingularityKChen/harness-projects/issues/195)。本次公开产物只有可审阅设计与实施计划；产品验收、issue 关闭和 ready 均须等待后续实现。Superseded by `Progress` 与 `Outcomes & Retrospective`（2026-10-01）：实现已完成；产品验收、issue 关闭和 ready 仍等待人类评审。A 不实现 #187/#188，不宣称 Gate E1 或 #4 完成。

## Context and Orientation

本计划的取证基线是 2026-10-01 的 `origin/main@cec5264f1b99757c78354f4c9ebb04442a01d930`。实施时在检出 `fix/repository-identity` 的工作树根运行命令；目录可以是 `.worktrees/repository-identity`。执行前重新读取 `git rev-parse HEAD origin/main`、`git status --short --branch`，基线变化须更新本节、反例和依赖判断。本节与下文各处的「当前」均指该取证基线，实施后的状态见 `Outcomes & Retrospective`。

外部身份是 Provider 连接上的对象键 `(bindingId, externalKind, externalId)`，跨工作区共享。entity 是内部稳定对象；externalIdentity.id 是身份行的稳定键。repository.id 是 Storage 的仓库挂载键，它不自动等于 entityId 或 externalIdentity.id。SQLite rowid 只是物理寻址键；TEXT 主键不是 rowid 别名，领域接口不能使用 rowid 表示这些对象。

当前 `packages/domain/src/identity.ts` 的 `ExternalIdentityKind` 仅五值：draft、issue、change_request、branch、worktree；`EntityKind` 已有 repository。`packages/storage/sqlite/migrations/002_identity_membership.sql` 的 CHECK 同样五值；`003_control_facts.sql` 的 repository.external_identity_id 引用身份行。端口写入 repository 因 CHECK 失败，而 `tests/contract/suites/storage-execution.js` 的 `seedExecutionPrereqs` 用 branch 伪装仓库身份。

`packages/core/src/identity.ts` 当前只有 `planningContentKind` 等函数，旧 `asExternalKind` 已不存在。`planningContentKind` 白名单为 issue/draft/change_request，其余返回 undefined。#195 的旧 fallback 描述不能变成恢复无调用者 API 的理由。Planning 内容三态 `ContentKind` 的 work_item/change_request/redacted 与 `MembershipContentKind` 三值保持各自职责；repository 不能成为项目条目内容，ProjectV2Item 仍不能成为身份种类。

SQLite 的 `putExternalIdentity` 按自然键 UPSERT，保留既有 id/entityId；fake 同样如此，但 fake 当前没有 externalKind 运行时白名单，JavaScript 调用可绕过 TS。迁移清单为 1–5；每版本 `BEGIN IMMEDIATE`，锁内重读已应用版本，DDL/数据步骤/版本记录同事务。现有 `MigrationDataStep.apply` 在 DDL 后运行，不能用于 DDL 前的形状复判。末句只服务 006 的 DDL 前复判，Superseded by Decision Log「按 D10 订正」（2026-10-01）：不新增复判。

迭代选择按真实瓶颈排列，不将工程建议写成已改规划事实。2026-10-01 的现场快照中选中三 issue 均为 P0/S；M2 的 #195 消除身份瓶颈，M4 的 #187/#188 共同消除 Start Work 两个连续 FK 断点。重要度与急迫度的独立裁决如下。

| 项目 | 急迫 / 重要 | 本轮处置与理由 |
|---|---|---|
| #195 | 立即 / 高 | PR A，先交付 Storage 身份契约；没有它，正确仓库登记无法实现 |
| #187 + #188 | 立即 / 高 | PR B 叠 A；仅修前置 FK 会暴露外部写后谱系 FK 与假 Saved，必须同闭环验收 |
| #129 | 近期 / 高 | 可由独立 UI owner 并行；#128 已 closed，不把旧 blockedBy 当现行阻塞 |
| #197 | 近期 / 高 | implementationKey 解析可独立；core/registry 邻接修改须明确 owner，不能与 B 混写 |
| #189 + #196 | 近期 / 高 | 分别处理同步作用域、adapter 全局未知 workItem 契约；本次不扩大到这两项 |
| #249 | 近期 / 中高 | CI 排队缺口建议下一独立闭环调查，当前无 Priority/Size，建议不冒充已设置字段 |
| #4 | Gate / 高 | 聚合验收须拆解，不能把局部 repository 修复当成六项跨 Provider 证明 |

A 与 B 修改同一 Storage 身份/迁移附近，实施不能并行写；B 必须基于 A 已验收 tree。B 的计划文件将新建，名称为 `2026-10-01-start-work-sqlite-prerequisites.md`；本计划不建立尚不存在的文件链接。其余候选的独立 owner 可以并行，不增加本轮承诺或改动它们的迭代、Status、原生阻塞关系。

## Design / Spec

独立设计与独立评审对三个可行候选作了裁决。设计 A 的 A1 是追加 v6 受控重建，A2 是重写新库 schema、显式拒绝旧世代并提供另文件转换；设计 B 的 A1 同为受控重建，A2 使用 writable_schema 精确修改 CHECK metadata。以下决策包含这些方案的机制，实施者无需访问本地研究稿。

| 方案 | 因果匹配、失败路径、恢复与生命周期 | 裁决 |
|---|---|---|
| 追加 v6 重建 | 正常 DDL 解析；支持合法旧库直接升级；风险集中于 FK 生命周期与复制，事务/备份可恢复 | 采纳两稿 A1，并补 DDL 前复判与较早前缀处理。Superseded by Decision Log「按 D10 订正」（2026-10-01） |
| 重写 002 + 新世代拒绝 + 另文件转换 | 新库可用，但旧库需完整转换工具与双世代入口；只拒绝不能完成升级闭环 | 拒绝设计 A 的 A2，成本外溢到用户恢复与全库转换。Superseded by Decision Log「按 D10 订正」（2026-10-01）：其中「原位改写 002」一半被采纳，「新世代拒绝与另文件转换」仍不做 |
| writable_schema metadata 更新 | 少复制，但错误 SQL 可损坏 schema；驱动防御配置、缓存刷新与 rollback 未获本轮证据 | 拒绝设计 B 的 A2，不能为约几十行收益引入未验证的恢复机制 |

选择不是折中汇总：domain 拥有 kind，Provider 拥有稳定 externalId，Storage 拥有引用/唯一性，迁移运行器拥有连接设置与事务；core 的 Start Work 注册留给 B。自然键不加入 workspaceId；同 binding 中 repository 与 branch 的同名字面量是两个对象，不能靠名称猜测或重分类历史 branch。

将新增 `ExternalIdentityKind.Repository = 'repository'`，以及 `parseExternalIdentityKind(value: unknown): ExternalIdentityKind`。已知值返回原值，未知值抛 `RangeError('unsupported external identity kind')`。两 adapter 的 `putExternalIdentity` 通过 Promise 拒绝未知 kind，在任何持久化写入之前校验；SQLite 方法如采用 async 包裹，不改变端口的 Promise 错误契约。`findExternalIdentity` 对未知查询仍可返回 undefined，不把 lookup 改成写入转换器。

保留 001–005 文件原文，新增 `006_repository_identity_kind.sql`。表替换只扩大 external_kind CHECK；显式复制六列及原 rowid，保留稳定 TEXT 键、实体/连接 FK、角色 CHECK、自然 UNIQUE 和 `external_identity_primary` 部分唯一索引。复制 rowid 仅保持当前列表实现的行为，不提升为端口排序承诺。先建新表、复制、drop 原表、rename 新表；不先 rename 原表，避免引用被 SQLite 自动指向临时名称。依据 [SQLite 受控结构变更流程](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不新增 006，原位修改 002。

迁移接口将新增显式 `Migration.rebuild?: MigrationRebuildStep`，其中 `preflight(db)` 为只读，`before(db)` 在锁内、DDL 前复判，`apply(db)` 在 DDL 后检查。此标记仅服务需要临时关闭 FK 的受控 rebuild，不给任意 SQL 自动关闭 FK。现有 005 的 `data` 语义不变。`REPOSITORY_IDENTITY_REBUILD` 将在独立短模块中实现，runner 负责 FK 的唯一生命周期。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不新增 `Migration.rebuild`，`migrate.ts` 与 `migrations.ts` 不改。

全体待应用步骤的 preflight 仍先于任何迁移。006 的预检支持空库与合法 1–5 前缀：在隔离内存连接顺序执行相同历史 DDL，建立该前缀的 schema 指纹，比较当前 `sqlite_schema` 的表、索引、触发器、视图及关键 PRAGMA 形状；版本为空却有未知用户对象、非支持形状、额外关联对象、FK 损坏均显式拒绝，原文件不改。002 尚未应用时允许 external_identity 不存在；不得让 fresh/[1] 因预检不存在的表而失败。内存指纹只执行 DDL，不递归调用 migrate；005 无 DDL，载体值检查仍归现有步骤。此为 006 支持的已知前缀检验，不宣称完成全产品 schema 世代管理。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不做前缀指纹与 DDL 前复判。

受控 runner 顺序固定：读取原 `PRAGMA foreign_keys` → 在 BEGIN 外设 OFF 并回读 0 → BEGIN IMMEDIATE → 重读版本与合法前缀 → 若已应用则 rollback/skip → `rebuild.before` 复判支持的 v5 结构与数据 → 执行 006 → `rebuild.apply` 检查 FK、integrity、索引及复制行 → 写版本 6 → COMMIT → finally 恢复原设置并回读。BEGIN 失败、检查失败、copy/drop/rename/index 失败、版本记录失败和并发 skip 全须走 finally；恢复失败应关闭连接并报告，不能返回业务 Storage。入口 `openDatabase` 为 ON，因此正常返回前必须为 1。[SQLite foreign_keys](https://www.sqlite.org/pragma.html#pragma_foreign_keys) 明确事务内切换无效。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不新增受控 runner，连接级 FK 设置不变。

新库仍顺序应用 1–6；合法较早前缀先升级至 5，再执行 6。支持 v5 的迁移数据/版本原子性；从较早前缀失败时，先前已提交版本不会撤销，错误须报告已提交版本，不写“整个启动字节不变”。preflight 拒绝则任何待应用迁移都未执行。重开文件验证是必要证据，不能以同连接查询替代。Superseded by Decision Log「按 D10 订正」（2026-10-01）：清单保持 1–5，新库顺序应用 1–5；订正后旧库的失效方式见 `Surprises & Discoveries` 的旧库探针。

## Global Constraints

旧版（含 006、`migrate.ts`、受控 rebuild 模块与升级测试的文件表，以及 658/800 行预算）已作废：Superseded by Decision Log「按 D10 订正」（2026-10-01）；原文留在 git 历史里本文件的首个提交。

正文中文、仓库相对路径；禁止写入本机绝对路径、内部系统或凭据。代码 + 测试合计（SQL 与测试均计入 code）目标约 150 行、硬停线 250 行；文档合计 ≤1300 行，目标改动 <300 行。逼近硬停线先找 dead code 与重复用例，不靠拆文件、拆函数或排除测试躲预算。

本批文件集是下表，这是它唯一的声明处；`Plan of Work` 与 `Progress` 只写「见 `Global Constraints`」。

| 文件 | 工作 |
|---|---|
| `packages/domain/src/identity.ts` | `ExternalIdentityKind.Repository`、`parseExternalIdentityKind` 与注释 |
| `packages/providers/fake/src/storage.ts` | `putExternalIdentity` 在任何写入之前经 parser 拒绝未知种类（Promise 拒绝） |
| `packages/storage/sqlite/src/storage.ts` | 同上；方法改为 `async`，守卫早于任何持久化写入 |
| `packages/capabilities/src/storage.ts` | 端口注释：`putExternalIdentity` 对未知种类以 `RangeError` 经 Promise 拒绝、早于任何写入（只改注释，不改签名） |
| `packages/storage/sqlite/migrations/002_identity_membership.sql` | 原位：`external_kind` 的 CHECK 加 `'repository'`，注释指向 D10 |
| `tests/contract/suites/storage-identity-membership.js` | 共享契约两条，fake 与 SQLite 都跑；未知种类反例含非字符串（`undefined` / `null` / 数字） |
| `tests/contract/suites/storage-sync.js` | 五值断言改六值 |
| `tests/contract/suites/storage-execution.js` | `seedExecutionPrereqs` 用 `repository` 登记仓库身份，不再用 `branch` 伪装 |
| `tests/contract/storage-contract.test.js` | `ASSERTION_BASELINE` 只替换那一条六值断言；新增身份面字面量台账 `IDENTITY_CASE_COUNTS` 与守卫 |
| `tests/contract/domain-enums.test.js` | `ExternalIdentityKind` golden |
| `tests/contract/domain-identity.test.js` | parser 正反控、自然键与角色语义、`planningContentKind` 反例 |
| `tests/integration/identity-membership-schema.test.js` | 显式 `'repository'` 正控与哨兵值被 CHECK 拒绝 |
| `docs/exec-plan/completed/2026-10-01-repository-identity-contract.md`、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md` | 本计划、索引行与遗留债务条目 TD-004 |

`tests/contract/suites/storage.js` 与台账常量 `CASE_LEDGER` / `ADDED_CASE_COUNT` 不在集合内：新增用例落在身份地基组，三组台账实测无需改动；身份面两组另设字面量台账 `IDENTITY_CASE_COUNTS`（见上表），依据见 `Surprises & Discoveries`。

保持自然键与稳定 ID、`MembershipContentKind` 三值、Planning 内容三态、005 的载体拒绝规则与包依赖方向；不改 `migrate.ts`、`migrations.ts`、001/003/004/005；不自动删库（旧开发库由人手动删库重建）、不猜测旧 branch 分类、不调用真实 GitHub Provider、不新增 domain 对上层依赖。A 与 B 在同一架构区域串行交接。仅允许从 issue labels/milestone/本计划投影 ExecPlan、Batch、Kind、Area、Gate、Priority、Size 等机械元数据；不写 Status、blocked-by、blocking，不新增管理 tag；订正后规模远低于旧估算，不触发「建议 Size 使用 L」，Size 以 Project 当前字段回读为准。

## Plan of Work

旧版（Batch A-1/A-2/A-3：含 006、受控 rebuild runner、非空旧库升级、五处故障与并发矩阵）已作废：Superseded by Decision Log「按 D10 订正」（2026-10-01）。设计评审门已按 Decision Log 的第一条新决策开启。批次改动的文件集合只在 `Global Constraints` 声明。

### Batch A-1 · 仓库身份可登记、未知种类拒绝

**最小闭环**：repository 能经 Storage 端口登记，并在 fake 与 SQLite 读回同一组稳定键；未知种类在两个适配器上以同一个 `RangeError` 经 Promise 拒绝，且不被登记成 issue。
**涉及文件**：主文件为 domain identity、共享身份 suite 与 schema 测试；完整集合见 `Global Constraints`。
- 先写判别性测试，并亲眼看它们因功能缺失而红：共享用例 `仓库身份通过端口登记并读回稳定键` 与 `未知身份种类拒绝且不得登记成 issue`（正控与反例在两个独立的库里、记录只差 kind；断言 Promise 以 `RangeError` 拒绝（反例含 `undefined` / `null` / 数字）、身份总数不变、`findExternalIdentity(binding, 'issue', 同一 externalId)` 仍为 undefined）；domain parser 正反控、自然键与角色语义、`planningContentKind` 反例；枚举 golden；`storage-sync.js` 的六值断言与 `ASSERTION_BASELINE` 中对应的那一条；schema 的显式 `'repository'` 字面量正控与哨兵值被 CHECK 拒绝。
- 再写最小实现：domain 枚举与 parser；两个适配器的写前守卫；002 原位把 CHECK 加 `'repository'`。测试里不使用只服务测试的生产代码分支。

**验证**：下节命令一（窄组）。期望旧生产代码上红且原因是功能缺失而不是拼写错误；实现后全绿；加枚举值而未改 002 时 `identity-membership-enums.test.js` 的逐值绑定变红（第二个天然红）。
**回滚**：回退本批提交；不涉及数据迁移，已应用旧 002 的开发库本来就按 D10 删库重建。

### Batch A-2 · 台账、旧库探针与交接

**最小闭环**：契约台账与基线只随真实新增变化；旧开发库的失效方式有一次性取证；宽验证通过；证据与偏差写回本计划。
**涉及文件**：`seedExecutionPrereqs` 与台账相关文件见 `Global Constraints`；本计划与索引行。
- `seedExecutionPrereqs` 改用 `repository`；按实际新增的注册数更新 `CASE_LEDGER.foundation.added` 与 `ADDED_CASE_COUNT`：现场计数后写进 `Surprises & Discoveries`（三组台账实测无需改动；身份面两组不在台账里，另设字面量台账与守卫）。保留两个适配器装配与每组注册守卫。
- 旧库探针（一次性、不入库、不写成永久测试）：用旧 002 与其余迁移建一个旧库文件，用新代码打开并写 repository 身份，记录错误文本；步骤与观察见 `Surprises & Discoveries`。
- 对新增用例做变异实验并写回 `Artifacts and Notes`；跑宽验证；整理提交序列。
- 按独立对抗验证的发现补守卫与证据：身份面台账、未知种类反例补非字符串、端口注释、遗留债务登记；每项变异先证明在补守卫之前存活，再证明补守卫之后被抓住。

**验证**：下节全部命令。
**回滚**：同 A-1。

## Validation and Acceptance

旧版（含 006 与升级测试的验证命令、非空旧库引用完整性 / 前缀与错误路径 / 并发与连接开关三行验收，以及 800/1300 的规模判据）已作废：Superseded by Decision Log「按 D10 订正」（2026-10-01）。

下列命令在检出 `fix/repository-identity` 的工作树根运行。该工作树必须有自己的 `node_modules`（`ls -l node_modules/@harness-projects/core` 期望指向 `../../packages/core`，见 `tests/README.md`），否则「先红」可能是对着别处的源码取得的。

    node --test tests/contract/domain-identity.test.js tests/contract/domain-enums.test.js tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js
    pnpm run typecheck
    pnpm run boundaries
    pnpm verify
    node scripts/rule-checks.mjs size origin/main
    node scripts/rule-checks.mjs disclosure origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD
    node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js

期望：窄组全绿，判别性新增用例在旧基线红、实现后绿；typecheck / boundaries / verify 退出 0；size 与 disclosure 通过；`git diff --numstat` 的 code 行数低于 `Global Constraints` 的硬停线；最后一条文档契约全绿。结构 lint 用的是仓库外 exec-plan 技能的 `scripts/lint_execplan.py`（输出 `OK: ExecPlan passed lint checks.`），不列为可复跑命令；仓库内的等价检查是最后一条文档契约（评审 P3，2026-10-02）。共享套件装配、计数和精确断言台账必须全部保留。

| 验收项 | 判定证据 |
|---|---|
| repository 确实可用 | 共享用例 `仓库身份通过端口登记并读回稳定键` 在 fake 与 SQLite 都绿：登记 entity + 身份 + 仓库后，读回的身份 id / entityId 与仓库记录的 externalIdentityId 同写入一致，同名 `branch` 查不到它；schema 测试的显式 `'repository'` 字面量正控绿 |
| 未知 kind 不变 issue | 共享用例 `未知身份种类拒绝且不得登记成 issue`：同形状合法正控先成功，未知 kind 只改 kind，两个适配器的 Promise 以同一个 `RangeError` 拒绝（反例含 `undefined` / `null` / `42`），身份总数不变，`findExternalIdentity(binding, 'issue', 同一 externalId)` 为 undefined；parser 对 `'bogus'`、空串、`undefined`、`null`、`42`、`'ProjectV2Item'` 抛 `RangeError`；`planningContentKind('repository'/'bogus'/'ProjectV2Item')` 仍为 `undefined` |
| CHECK 与枚举一致 | `identity-membership-enums.test.js` 的逐值绑定绿（只加枚举值而不改 002 会红，已实测）；哨兵值与 `ProjectV2Item` 由 CHECK 拒绝，且断言的是 CHECK 失败而不是别的约束 |
| 自然键与角色没有退化 | domain 用例：repository 与 branch 同名字面量是两个对象，重复观察保留首个 id 与 entityId，primary 按实体过滤；schema 套件既有的第二 primary 与 role CHECK 用例保持绿 |
| 台账与基线仍是守卫 | `storage-contract.test.js` 的切分守卫与装配守卫保持绿，`ASSERTION_BASELINE` 只替换那一条六值断言（`git diff -U0 origin/main...HEAD -- tests/contract/storage-contract.test.js` 里被删的行只有它）；身份面守卫在删掉任一身份面用例、或删掉 / 改写任一身份面断言时变红（断言集合基线由第一轮 MVP 评审补上） |
| 用例有判别力 | 旧生产代码上红的命令与原因，以及变异实验各自被预期用例抓住，见 `Artifacts and Notes` |
| 旧库失效方式已知 | 一次性探针：旧 002 的库被新代码打开，repository 身份写入被旧 CHECK 拒绝，文本与读回见 `Surprises & Discoveries`；处置为删库重建（D10） |
| 人类可审阅 | 人类在新建的库上用新代码经端口登记 repository 并读回；评审不要求旧库升级 |

人类验收记录命令、当前 head/base、预期与实况。最终 push 后回读 head/base/checks/issue/thread，才可考虑 ready；合并只能由人类决定，且只用 rebase merge。本批不执行 ready 与合并。

## Progress

- [x] (2026-10-01 12:51 CST) 读取根规则、当前domain/storage/runner/契约，比较两位设计者每PR的多方案。
- [x] (2026-10-01 12:51 CST) 独立裁决A先于B，写入本spec+plan，明确运行时边界、pre-DDL复判与预算。
- [x] (2026-10-01 12:51 CST) 重开磁盘完成第二次语义审读，`lint_execplan.py` 返回 `OK: ExecPlan passed lint checks.`；规模以 `wc -l docs/exec-plan/completed/2026-10-01-repository-identity-contract.md` 重算，不固定易失行数。
- [x] (2026-10-01 12:55 CST) 主控完成索引、技能lint、结构与本地链接；文档契约9/9、暂存diff检查及公开面扫描通过，人工五类目未命中。
- [x] (2026-10-01 12:51 CST) 后续实施交接前重新回读本分支draft PR、双向issue关联及非Status元数据；发布状态以GitHub当前快照为准。（2026-10-02 最终 push 后回读完成）
- [x] (2026-10-01 12:51 CST) 已取消：~~后续A-1/A-2/A-3实施与红→绿、非空升级/恢复验收，当前未执行。~~ Superseded by Decision Log「按 D10 订正」（2026-10-01）：该项拆为下列实际完成的 A-1、A-2；A-3 并入 A-2；非空升级/恢复验收不执行。
- [x] (2026-10-01 16:21 CST) 设计评审门已开启（Decision Log 第一条新决策）；读取 brief、D10 与 `Global Constraints` 的文件集，在未改动的树上跑窄组建立基线（数字见 `Artifacts and Notes`）。
- [x] (2026-10-01 16:32 CST) Batch A-1：先写判别性测试，在旧生产代码上红且失败原因均为功能缺失；再依次落 domain 枚举与 parser、两个适配器的写前守卫、002 原位扩 CHECK，窄组转绿；变异实验各被预期用例抓住。数字与证据见 `Artifacts and Notes`。
- [x] (2026-10-01 16:36 CST) Batch A-2 前半：`seedExecutionPrereqs` 改用 `repository`；台账现场计数与旧库探针见 `Surprises & Discoveries`。
- [x] (2026-10-01 16:40 CST) Batch A-2 后半：本计划按 D10 订正并写回证据；宽验证结果见 `Artifacts and Notes`。
- [x] (2026-10-01 17:25 CST) 独立对抗验证（无 P0/P1）之后的一轮修复：身份面台账与守卫、未知种类反例补非字符串、端口注释、遗留债务登记 TD-004、本计划文字订正；各变异现被抓住，证据见 `Artifacts and Notes`，债务条目见 `docs/exec-plan/tech-debt-tracker.md`。
- [x] (2026-10-01 17:50 CST) 独立验收：在最终树上复跑全部验证命令、完整变异表、旧生产代码上的红与旧库探针，未改代码；裁决见 Decision Log「独立验收裁决」，交给 B 的接口与重跑触发条件见 `Interfaces and Dependencies`，复跑证据见 `Artifacts and Notes`。
- [x] (2026-10-02 CST) 第一轮 MVP 评审（review 5391344331：5 条 P3，无 P0 / P1）并获批准（review 5391435325）。按意见修订：身份面补断言集合基线（删掉「不留行 / 不变 issue」两条断言的变异 M10c 由 `156/156` 全绿转为守卫变红）；`packages/ui-model/src/types.ts` 的 `ClientExternalKind` 注释补 repository；验证命令去掉仓库外占位；Decision Log 写明错误消息不带值的取舍。提交序列整理为两个可独立回滚的交付物（实现 + 测试、计划归档），变基到 `main@df199a5`。
- [x] (2026-10-02 CST) 人类授权 ready 与 rebase merge（`merge_method=rebase`）；本计划随本 PR 移入 `docs/exec-plan/completed/`，合并回执按顶部命令回读。

## Surprises & Discoveries

旧issue点名的asExternalKind在当前core不存在。独立调查与全仓搜索一致；重新引入只会扩大API，不解决当前fake边界。现有enum/schema测试可全部绿却没有repository；新独立正控必须避免只动态比较两个同时缺值的集合。

独立真实临时库探针在此基线复现repository CHECK失败；受控 BEGIN 外 FK OFF 重建后子引用保留、FK=[]、integrity=ok。仅 defer_foreign_keys 的候选即使提交前FK检查为空，COMMIT仍可失败，不能替代连接级控制。上述为设计探针，不是尚未创建的正式升级测试通过。这些探针只论证 006 重建，Superseded by Decision Log「按 D10 订正」（2026-10-01）：不实施，仅在将来需要保留旧库升级时重新生效。

当前 migration runner 的 data.apply 位于DDL后。独立评审因此新增before hook，防止把锁内复判放在已经drop/rename之后。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不新增 before hook。另发现必须同步domain-enums golden、sharedSync五值断言及精确台账；这些不是随意改宽测试。

本计划写成时没有纳入控制计划 D10：当时的设计是「保住已有本地库」，因此追加 006 受控重建，原估算 658 行中约 508 行专为旧库升级（受控 runner、前缀指纹、升级 / 并发 / 故障矩阵、连接生命周期测试）。D10 被指出后订正，订正后的代码 + 测试规模见 `Artifacts and Notes` 的宽验证。

旧库探针（一次性，2026-10-01 16:33 CST，检出 `fix/repository-identity` 的工作树根，新代码）：把 `git show cec5264:packages/storage/sqlite/migrations/002_identity_membership.sql`（旧 002；`cec5264` 是本分支起点，`origin/main` 的祖先）连同其余迁移文件复制到仓库外的临时目录，用 `migrate(db, { dir: <临时目录> })` 建旧库文件，再用新代码 `createSqliteStorage(file)` 打开，经端口写入。观察：`migrate` 返回 `{"applied":[1,2,3,4,5],"version":5}`；库内 CHECK 为 `CHECK (external_kind IN ('draft', 'issue', 'change_request', 'branch', 'worktree'))`；新代码打开时 1–5 已记录，运行器不重放 002；写 issue 身份成功（正控）；写 `repository` 身份被拒绝，错误类型 `Error`，文本 `CHECK constraint failed: external_kind IN ('draft', 'issue', 'change_request', 'branch', 'worktree')`；读回该身份为 `undefined`，身份总数仍为 1，没有被静默登记成别的种类；同一调用在新库上成功。与 D10 一致：旧开发库失效响亮而非静默，处置为删库重建。

两个适配器的红各有来源。fake 没有种类白名单，所以 `仓库身份通过端口登记并读回稳定键` 在旧代码上对 fake 是绿的，红的是未知种类用例（`Missing expected rejection (RangeError)`：fake 当时静默接受了未知种类）；SQLite 的 CHECK 本就拒绝未知值，若只断言「被拒绝」，该用例在旧代码上就是绿的，判别性来自断言同一个 `RangeError`（旧代码给出的是 `Error: CHECK constraint failed…`）。见 Decision Log 第三条新决策。

`CASE_LEDGER` / `ADDED_CASE_COUNT` 实测无需改动，但身份面需要自己的台账。台账只记 `suites/storage.js` 的三组；本批新增的两条在身份地基组，而身份面两组既不在台账里，装配守卫又拿组自己的条数当期望，删用例时两边同降、谁也发现不了。独立对抗验证先发现这一缺口（删任一新增共享用例，全套仍绿），实施者在补守卫之前的树上复现：窄组为 `tests 153 / pass 153 / fail 0`，比未删时少 2 条（fake 与 SQLite 各一处注册）。因此 `tests/contract/storage-contract.test.js` 新增字面量台账 `IDENTITY_CASE_COUNTS`（身份地基组 6、身份同步组 5）与对应守卫，增删身份面用例必须有意改它；原计划的「台账增加」与相应行数估算不成立，三组台账实际新增 0。现场计数在检出 `fix/repository-identity` 的工作树根运行：

    node --input-type=module -e "const s = await import('./tests/contract/suites/storage.js'); const m = await import('./tests/contract/suites/storage-identity-membership.js'); console.log(Object.entries(s.STORAGE_SUITE_GROUPS).map(([g, f]) => g + '=' + s.countSuiteCases(f)).join(' '), 'identityFoundation=' + s.countSuiteCases(m.storageIdentityFoundationSuite), 'identitySync=' + s.countSuiteCases(m.storageIdentitySyncSuite), 'PRE_SPLIT=' + s.PRE_SPLIT_CASE_COUNT, 'ADDED=' + s.ADDED_CASE_COUNT)"

期望输出 `foundation=13 sync=9 execution=13 identityFoundation=6 identitySync=5 PRE_SPLIT=18 ADDED=17`：三组合计 35 = 18 + 17 与台账一致（未改），身份面两组的条数就是 `IDENTITY_CASE_COUNTS` 的字面量，身份地基组 6 条中有 2 条是本批新增。

`planningContentKind` 没有直接测试文件：仓库里没有测试直接 import 它，只有 `tests/e2e/chain-bootstrap.test.js` 的「身份：没有内容身份的条目不登记外部身份」经 bootstrap 用 `project_item` 间接覆盖。反例断言（`repository` / `bogus` / `ProjectV2Item` 为 undefined，另配三个规划种类的正控）因此放进文件集内的 `tests/contract/domain-identity.test.js`，经 `@harness-projects/core` 引入，不新建文件、不扩大文件集。

`origin/main` 在实施期间前进了一个提交：`git log --oneline cec5264..origin/main` 只有一条 `chore(ci): bump pnpm/action-setup …`，仅改 `.github/workflows/ci.yml` 与 `merge-gate.yml`（`git diff --stat cec5264 origin/main` 回读）。本分支起点仍是 `cec5264`、未变基；`size` 与 `numstat` 走三点 diff（merge-base），不受影响。是否变基由主控在交接时决定。

`docs/` 里没有需要订正的「五值种类集合」现状句：`grep -rn "五个取值\|asExternalKind" docs` 命中的只有本计划，以及 `docs/architecture/gate-e1-membership-and-draft.md` 与 `docs/architecture/gate-e1-ruling.md` 对 E1 实验当时模型缺口的历史记录，按「历史记录不改」保持原样。

SQLite 的未知种类守卫在基类入口（`write` / `mutate`）之外：在已关闭的实例或已结算的事务作用域上，未知种类得到 `RangeError`，而不是 `CLOSED_MESSAGE` / `SETTLED_TRANSACTION_MESSAGE` 的快速失败文本。没有测试断言这一交叉情形，影响小（调用方本就用错了实例），已知边界，不改。

`update_tech_debt_tracker.py` 与本仓库的表格式 tracker 不兼容：脚本只解析 `###` 块条目。在 tracker 的副本上执行 `add`（`--tracker` 指向副本，真文件未动）后，Open Items 里 TD-001 至 TD-003 三行表格全部消失，各节的说明段被占位符取代，所以没有对真文件运行，而是按 tracker 文件头声明的列定义手工追加一行（TD-004）。脚本与 tracker 的格式分歧本批不处理。

## Decision Log

Decision：采纳两份独立稿的追加v6受控rebuild，拒绝rewrite旧库转换与writable_schema候选。Rationale：以已知FK/事务机制直接满足端口与升级结果，避免风险外溢；见Design / Spec的比较。Date/Author：2026-10-01 12:51 CST / 独立评审者。Superseded by Decision Log「按 D10 订正」（2026-10-01，即本节下文第二条新决策）。

Decision：A独立#195，B将#187/#188组成同一闭环并叠A。Rationale：仓库身份是接口依赖；只补repository会暴露外部写后关系FK失败，不能制造中间假Saved。Date/Author：2026-10-01 12:51 CST / 独立评审者。

Decision：本次只发布draft spec/plan，不再次请求已授权的设计阶段批准。Rationale：产品实施仍需人类设计评审，本轮文档与draft是其可审阅输入。Date/Author：2026-10-01 12:51 CST / 主控授权、独立评审记录。Superseded by 本节下文第一条新决策（2026-10-01）：设计评审门已由人类伙伴的会话指令开启。

Decision：只投影现有milestone/labels及计划预算，不写Status或原生blocking。Rationale：规划接受由人拥有，stack顺序不是原生阻塞授权。Date/Author：2026-10-01 12:51 CST / 独立评审者。

Decision：人类伙伴 2026-10-01 在会话中指示按本 spec/plan 实施，视为设计评审门已开启。Rationale：该门的唯一目的是让人类接受设计，指令本身即接受。Date/Author：2026-10-01 16:40 CST / 主控（Claude）。

Decision：按控制计划 D10 订正——不追加 006 受控重建，原位修改 002 的 external_kind CHECK，取消 Migration.rebuild、FK 生命周期、旧库升级验收与备份恢复流程。Rationale：①D10（docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md）与 003 文件头明确首次 MVP 发布前不承担迁移与兼容成本；②#195 验收只要求 002 CHECK 与 ExternalIdentityKind 一致并经共享契约读回，不含旧库升级；③SQLite 上 Start Work 从未成功（#187/#188），库中不可能有 repository 行，没有被保护的真实数据；④原估算 658 行中约 508 行专为旧库升级；⑤旧库在首次写 repository 身份时由旧 CHECK 报错（响亮、非静默），处置为删库重建；⑥同类工具对 SQLite 改 CHECK / 主键只有"重建表"一条路：SQLite 官方文档称它直接支持的结构变更只有 rename table / rename column / add column / drop column，其他变更走 12 步重建，第 1 步（事务开始之前）先 `PRAGMA foreign_keys=OFF`（https://www.sqlite.org/lang_altertable.html ）；Alembic batch 的 move-and-copy 重建会省略未命名的 CHECK 约束（1.20 之前静默，之后给警告）（https://alembic.sqlalchemy.org/en/latest/batch.html ）。这些都是为**已发布** schema 自动化的机制，首发前不承担这类成本与 D10 一致；Django 迁移文档（https://docs.djangoproject.com/en/6.0/topics/migrations/ ）只提供 squash（把多条迁移压缩为一条）这类整理已有迁移链的做法，没有写首发前可重置迁移，所以「首发前不保留迁移链」是 D10 自己的裁决，不借外部文档背书。Cost if wrong：需要保留旧库升级时，在本层之上追加 006 与受控 rebuild runner（≈500 行），本层的 parser/guard/契约用例不返工。Date/Author：2026-10-01 16:40 CST / 主控（Claude）。

Decision：共享契约用例把未知种类的拒绝断言为 `RangeError('unsupported external identity kind')`（fake 与 SQLite 同一个错误），两个适配器各自在写前守卫，而不是只断言「Promise 拒绝」、让 SQLite 依赖 002 的 CHECK。Rationale：①SQLite 的 CHECK 本就拒绝未知值，只断言「被拒绝」时 SQLite 的守卫没有失败测试可驱动（旧代码给出的是 `Error: CHECK constraint failed…` 而不是 `RangeError`）；②端口级失败语义由 domain 的 parser 定义一次，不依赖驱动措辞，也不依赖 CHECK 与枚举是否同步；③变异实验显示去掉任一适配器的守卫、把守卫改成同步抛出、或让守卫只对字符串生效，都让对应适配器的用例变红（后者在反例补上 `undefined` / `null` / 数字之后，见 `Artifacts and Notes`）。Cost if wrong：若将来要把错误收敛进 capabilities 的错误模型，只改 parser 与两处守卫，用例里的断言随之调整，不涉及存储格式。Date/Author：2026-10-01 16:40 CST / 实施者（Claude，dev-a）。

Decision：第一轮 MVP 评审的 P3「拒绝消息不带被拒的值」采纳为写明取舍，不改消息。Rationale：上一条「独立验收裁决」②把 `assertComparableSourceVersion` 引作同形先例，只指「端口级失败由一个解析器定义一次、两个实现同一个错误」，不指消息形状——那条消息带值、中文，这条是固定英文整串；固定整串让共享契约能对替身与 SQLite 做逐字比对，且 `undefined` / `null` / `42` / Symbol 一类非字符串取值不必经字符串化。代价是日志里看不到被拒的值，定位时在调用点取。Cost if wrong：改成 `unsupported external identity kind: ${String(value)}` 并把三处共享断言改成逐值整串比对，量级十行以内，契约不返工。Date/Author：2026-10-02 / 评审修订（Claude）。

Decision：把「`putRepository` 不约束仓库身份的种类」登记为技术债 TD-004（`docs/exec-plan/tech-debt-tracker.md`），本批不收紧。Rationale：收紧要改两个适配器与端口语义并改写三处仍用非 repository 身份充当仓库身份的测试，超出本批文件集，且与仓库登记闭环（#188）相邻；不登记则这条隐含契约无人声明。Cost if wrong：若评审要求本批收紧，在两个适配器的 `putRepository` 加种类检查并改写那三处测试（量级几十行），本批的 parser 与守卫不返工。Date/Author：2026-10-01 17:24 CST / 主控（Claude）指示，实施者（Claude，dev-a）记录。

Decision：独立验收裁决——维持第三条新决策（两个适配器各自守卫、共享契约断言同一个 `RangeError`），不简化成 SQLite 只靠 002 的 CHECK、断言放宽为「被拒绝」；`parseExternalIdentityKind` 的签名与返回值不改；SQLite 守卫留在基类入口之外，不挪进队列；002 不另加文件头说明。Rationale：①共享契约的用途是让替身与真实实现在端口上不可区分。去掉 SQLite 守卫后，未知种类在 SQLite 上按取值得到 `CHECK constraint failed`（`'bogus'`、`'ProjectV2Item'`、`42`）或 `NOT NULL constraint failed`（`undefined`、`null`），在替身上得到 `RangeError`；断言一放宽，这个分叉没有任何用例会发现。判错代价不对称：保留只多 SQLite 的 3 行与 3 处整串断言，简化则留下潜伏的替身 / 真实分叉。②仓库已有同形先例：#203 的 `sourceVersion` 载体由 capabilities 的 `assertComparableSourceVersion` 抛 `RangeError`，两个适配器都在写入前调用，共享同步组按消息断言；执行面的状态枚举（替身抛 `Error`、SQLite 靠 003 的 CHECK、用例只断言拒绝）是较弱的形态，本批跟随较强的先例。③返回值在生产中被丢弃，但签名属于人类已接受的 `Design / Spec`，「解析并返回原值」也让将来从无类型数据读种类的调用方直接使用返回值；改成 `asserts` 签名只省 1 行，却要同步 spec、端口注释、测试与 B 的引用。④守卫挪进 `mutate` 只改变「已关闭实例或已结算事务上又传了未知种类」这种双重误用的报错顺序，两种顺序都拒绝且不留行；挪动会改两个适配器的代码、迫使 B 重跑完整验证，收益不抵成本，已知边界见 `Surprises & Discoveries`。⑤002 改动行上方的注释已写明 D10 与「旧开发库删库重建」，旧库首次写 repository 身份时报的 `CHECK constraint failed: external_kind IN (…)` 指向的正是这一行，再加文件头是同一事实的第二份。Cost if wrong：①②删 SQLite 守卫并放宽共享断言，约 5 行；③改名为 `assertExternalIdentityKind` 并同步引用，约 10 处；④两处守卫挪进各自的写入闭包并重做变异证明，约 6 行；都不涉及存储格式。Date/Author：2026-10-01 17:50 CST / 验收者（Claude，accept-a）。

## Idempotence and Recovery

旧版（006 受控重建、备份恢复、升级预演与回滚备份）已作废：Superseded by Decision Log「按 D10 订正」（2026-10-01）。

相同身份自然键重复写保留最初 id / entityId；重复 `migrate` 返回 applied=[]（运行器语义不变）。未知种类的写入在任何持久化写入之前被拒绝，失败不留半写行，可直接重试。

已应用旧 002 的开发库不迁移，处置为删库重建（首发前没有需保住的数据，D10）。它的失效方式是响亮的：首次写 repository 身份时由旧 CHECK 拒绝，文本见 `Surprises & Discoveries`，不会被静默登记成别的种类。本批回滚：回退本批提交即可，没有数据迁移要撤销。需要保留旧库升级时的路径见 Decision Log 第二条新决策的 Cost if wrong。

## Interfaces and Dependencies

Node版本以 `.nvmrc` 为准（当前26），pnpm版本以package.json为准。本地node:sqlite及现有workspace依赖即可；不需要GitHub凭据或真实Provider写入。存储端口 `putExternalIdentity`/`findExternalIdentity`/`putRepository` 的ID语义不变；domain导出使用既有identity.ts入口。migration新hook只在Storage对象构造前的未外借连接运行。Superseded by Decision Log「按 D10 订正」（2026-10-01）：没有新hook。

人类是后续产品实施的设计验收者与最终合并者；A owner独占Global Constraints文件集，B待A验收再移交。未来B决定工作区repository挂载的键，不改A的canonical外部身份自然键。

交给 B（#187/#188，叠在本分支之上）的接口，均已在本分支落地并有测试钉住：①`packages/domain/src/identity.ts` 的 `ExternalIdentityKind.Repository`（`'repository'`）与 `parseExternalIdentityKind`（语义见 `Design / Spec`）；B 登记仓库身份用 `ExternalIdentityKind.Repository`，不用 `branch` 或别的种类代替。②两个适配器的 `putExternalIdentity` 对未知种类以 `RangeError('unsupported external identity kind')` 经 Promise 拒绝、早于任何写入；契约写在 `packages/capabilities/src/storage.ts` 的端口注释，共享用例 `未知身份种类拒绝且不得登记成 issue` 在两个实现上钉住。③002 的 `external_kind` CHECK 原位含 `'repository'`，迁移清单仍是 1–5；B 不为此追加迁移，旧开发库删库重建（D10）。④`tests/contract/suites/storage-execution.js` 的 `seedExecutionPrereqs` 已用 `repository` 登记仓库身份；`tests/contract/storage-contract.test.js` 的 `IDENTITY_CASE_COUNTS` 是身份面两组条数的字面量台账，B 在这两组增删用例要同步改它；`CASE_LEDGER` / `ADDED_CASE_COUNT` 本分支未改，`ASSERTION_BASELINE` 只替换了六值那一条，B 按相对本分支的增量重算。⑤与 #188 相邻、本分支不收口的是 TD-004（`putRepository` 不约束身份种类，见 `docs/exec-plan/tech-debt-tracker.md`）。

本分支的最终 head 以 `git rev-parse fix/repository-identity` 回读（push 后应与 `gh pr view 251 -R SingularityKChen/harness-projects --json headRefOid` 一致），本文不写 SHA。B 的重跑触发条件：在 B 的检出里 `git merge-base --is-ancestor fix/repository-identity HEAD` 非零退出（本分支 head 前进、被改写或随 `origin/main` 变基），先重基到它；重基后若 `git diff --name-only <B 原所基的本分支 head> fix/repository-identity -- packages tests` 非空，重跑 B 的窄组、`pnpm run boundaries` 与 `pnpm verify`；只有 `docs/` 变化时，重跑 B 的文档检查与 `size` / `disclosure`。

## Outcomes & Retrospective

目前产物是可独立审阅的计划，生产code/test变动为0，未创建的新测试与迁移未执行。2026-10-01 12:55 CST在检出 `fix/repository-identity` 的工作树完成技能lint、结构与本地链接、9/9文档契约；提交前机械扫描与人工五类目均通过。产品验收仍未执行。Superseded by 下一段（2026-10-01 实施完成后的结果）。

遗留边界：全产品schema世代控制、人工历史branch映射、Start Work注册/端点由后续闭环负责；#4 Gate E1仍需完整六项跨Provider证据。实施若引入新的维护债务，应在同一控制计划记录并按根规则写 `docs/exec-plan/tech-debt-tracker.md`，当前文档阶段不改tracker或提前宣称解决旧债。Superseded（2026-10-01）：实施中产生的债务 TD-004 已登记，见下文「遗留」。

实施结果（2026-10-01 16:40 CST，第二轮修复后于 2026-10-01 17:25 CST 更新，检出 `fix/repository-identity`）：domain 新增 `ExternalIdentityKind.Repository` 与 `parseExternalIdentityKind`；fake 与 SQLite 的 `putExternalIdentity` 在任何写入之前以同一个 `RangeError` 经 Promise 拒绝未知种类；002 原位把 CHECK 扩为六值；共享契约两条（fake 与 SQLite 都跑）、schema 的显式正控与哨兵、枚举 golden、六值断言与基线中对应的那一条、`seedExecutionPrereqs` 同步；第二轮补 capabilities 端口注释、身份面字面量台账与守卫、未知种类反例的非字符串。窄组与宽验证（typecheck、boundaries、`pnpm verify`、size、disclosure、diff --check、lint、文档契约）的结果见 `Artifacts and Notes`。

与计划的偏差：①按 D10 订正，范围由 658 行估算收敛（实测行数见 `Artifacts and Notes` 的宽验证）；②三组台账 `CASE_LEDGER` / `ADDED_CASE_COUNT` 实测无需改动，身份面两组另设字面量台账 `IDENTITY_CASE_COUNTS`；③`planningContentKind` 反例放入 `domain-identity.test.js`；④共享用例断言同一个 `RangeError`（第三条新决策）。①–④的依据都在 `Surprises & Discoveries`。⑤文档改动略超 `Global Constraints` 的 <300 目标（观察时刻 2026-10-01 17:50 CST 为 303 行，以 `node scripts/rule-checks.mjs size origin/main` 回读），多出的是独立验收写回的交接事实与复跑证据，离 1300 的上限很远。

遗留：A 不实现 #187/#188，仓库登记与 Start Work 的 FK 前置由 B 负责；三处测试仍用非 repository 身份充当仓库身份——`tests/integration/storage-restart.test.js` 约第 50、62 行（issue 身份 `identity-1`，与工作项 `entity-1` 同一行）与约第 317 行（`branch`），`tests/contract/suites/storage.js` 约第 115–116 行（`branch`，且挂在 work_item 实体上）——它们之所以仍绿，是因为 `putRepository` 不约束身份种类；这条隐含契约登记为 TD-004（`docs/exec-plan/tech-debt-tracker.md`），超出本批文件集，不改；旧开发库按 D10 删库重建；人类评审、ready 与合并由人类决定。

独立验收（2026-10-01 17:50 CST）：结论 ACCEPT_WITH_NOTES。#195 三条验收、新增用例的判别力与宽验证在最终树上复现，验收未改代码；notes 是本节「遗留」所列的 TD-004 与 `Surprises & Discoveries` 记下的 SQLite 守卫已知边界。裁决见 Decision Log「独立验收裁决」，复跑证据见 `Artifacts and Notes`。

## Concrete Steps

现在完成本文件存盘、再次语义审读、按根规范lint与公开面检查；主控更新索引、整理文档提交、开draft A，回读当前head/base/draft/closingIssuesReferences/reviewThreads/checks和issue反向关联。后续实施按A-1→A-2→A-3执行，每批将真实红/绿命令和恢复演练结果写回本计划。Superseded by Decision Log「按 D10 订正」（2026-10-01）：批次为 A-1、A-2，没有恢复演练。

订正后实施已按 `Plan of Work` 完成并写回证据，剩下的是交接。push 之后由主控回读：

    gh pr view 251 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences,statusCheckRollup
    gh pr checks 251 -R SingularityKChen/harness-projects

期望：`headRefOid` 等于 `git rev-parse fix/repository-identity`，`closingIssuesReferences` 含 195，checks 全部 pass；ready 与合并由人类决定。交给 B 的接口与重跑触发条件见 `Interfaces and Dependencies`。

## Artifacts and Notes

观察快照（2026-10-01 12:55 CST；检出 `fix/repository-identity` 的暂存工作树，尚未发布）：`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed /0 failed；技能lint为OK；13章次序与本地Markdown链接解析通过。`git diff --cached --check` 退出0，暂存diff经 `scanDiff` / `tally` 检查为公开面0命中、code=0、docs=196；这是记录前一次暂存观察，最终行数须重新以 `git diff --numstat origin/main...HEAD` 核算。人工检查凭据、本机身份、账号个人信息、内部系统与保密内容均无命中，commit使用既有GitHub no-reply作者邮箱。

正式证据只记录仓库相对路径、检出分支或观察时刻/head、命令与小段输出。规划快照和独立研究稿是本地设计输入，本计划已吸收其必要事实与取舍，不发布其本机路径。schema升级证据须附稳定TEXT键/引用比较，rowid只能作为实现级保持记录；[SQLite rowid定义](https://www.sqlite.org/rowidtable.html)支持这一身份区分。

RED→GREEN 记录（2026-10-01，检出 `fix/repository-identity` 的工作树根）。失败栈指向本工作树自己的 `packages/`，不是别处的检出，满足 `tests/README.md` 对隔离 worktree 的要求。下称「窄组」即 `Validation and Acceptance` 的命令一。

- 基线（树未改动）：`tests 147 / pass 147 / fail 0`。
- RED（只写测试，生产代码未改）：`tests 148 / pass 124 / fail 24`，即 23 条功能缺失加 1 条切分守卫（`ASSERTION_BASELINE` 尚未同步，同步该一条后消失）；终态测试集在旧生产代码上重跑为 `tests 149 / pass 126 / fail 23`。失败原因均为功能缺失：`domain-identity.test.js` 整个文件在链接期失败，`SyntaxError: The requested module '@harness-projects/domain' does not provide an export named 'parseExternalIdentityKind'`；枚举 golden 缺 `"Repository":"repository"`；同步组六值断言在 fake 与 SQLite 上都缺 `'repository'`；SQLite 身份地基组 `仓库身份通过端口登记并读回稳定键` 为 `CHECK constraint failed: external_kind IN ('draft', 'issue', 'change_request', 'branch', 'worktree')`；SQLite 的 `未知身份种类拒绝且不得登记成 issue` 拿到的是同一条 CHECK 的 `Error` 而不是 `RangeError`；fake 的同名用例为 `Missing expected rejection (RangeError)`；schema 的显式 `'repository'` 正控、SQLite 执行组 12 条（`seedExecutionPrereqs` 改用 repository）与分叉格 3 条同为 CHECK 失败；`ASSERTION_BASELINE` 尚未同步时，切分守卫报 `sync 组有 1 条切分时的断言在当前文件里消失`，同步该一条后转绿。
- GREEN 一，domain 枚举与 parser 落地：`tests 155 / pass 135 / fail 20`，domain 用例与 golden 转绿；`identity-membership-enums.test.js` 的 `DDL 的 CHECK 取值集合与包常量逐值绑定` 变红（`- 'repository'` 在 CHECK 里缺失），这是第二个天然红。
- GREEN 二，两个适配器的写前守卫落地：`pass 137 / fail 18`，未知种类用例在 fake 与 SQLite 上转绿，其余红只剩依赖 002 的 SQLite 用例与 schema 用例。
- GREEN 三，002 原位加 `'repository'`：窄组 `tests 155 / pass 155 / fail 0`（147 个基线用例 + 8 个新增：domain 3、schema 1、共享用例 2 条 × 两个适配器）。

变异实验（每项先用 `git diff --numstat` 证明变异已应用，再跑窄组，随后 `git checkout` 还原；括号内是红的用例数）：

- 守卫与 parser：parser 永不抛出、parser 对未知值回退成 `issue`（各 3 红：domain parser 用例与两个适配器的未知种类用例）；去掉 SQLite 守卫、去掉 fake 守卫（各 1 红：对应适配器的未知种类用例）；把任一适配器的守卫从 `async` 方法改成同步抛出（各 1 红，证明断言的是 Promise 拒绝）。
- 002 与枚举：002 缺 `'repository'`（18 红：schema 正控、逐值绑定、SQLite 读回与执行组）；002 额外接纳 `'ProjectV2Item'`（2 红：schema 哨兵与逐值绑定）；枚举缺 `Repository`（37 红）。
- 自然键与内容种类：自然键忽略种类（1 红：domain 自然键用例）；SQLite `findExternalIdentity` 忽略种类（1 红：读回用例里同名 `branch` 查不到的断言）；`planningContentKind` 的白名单改取自 `ExternalIdentityKind`（1 红：domain 的 `planningContentKind` 用例）。

第二轮（独立对抗验证之后）的变异证明，每项先用 `git diff -U0` 证明已应用，再跑窄组，随后还原：补守卫之前，删掉任一新增共享用例（窄组 `tests 153 / pass 153 / fail 0`）、把 fake 或 SQLite 的守卫改成只对字符串生效（各 `tests 155 / pass 155 / fail 0`）都存活；补身份面台账与非字符串反例之后：删掉任一新增共享用例各 1 红（身份面守卫，`tests 154 / pass 153 / fail 1`），fake 守卫只对字符串生效 1 红（fake 的未知种类用例），SQLite 守卫只对字符串生效 1 红（SQLite 的未知种类用例）（后两项 `tests 156 / pass 155 / fail 1`）。

宽验证（观察时刻 2026-10-01 17:25 CST，代码提交 `fe4d980`，在整理后的最终代码提交上重跑，检出 `fix/repository-identity` 的工作树根；文档侧检查在最终文档提交上复核；命令与期望见 `Validation and Acceptance`）：

- 窄组：`tests 156 / pass 156 / fail 0`（GREEN 三的 155 加第二轮新增的身份面守卫 1 条）；`pnpm run typecheck` 退出 0；`pnpm run boundaries` 为 `tests 8 / pass 8 / fail 0`。
- `pnpm verify` 退出 0：contract + integration + e2e 为 `tests 918 / pass 918 / fail 0`，mvp0 为 `tests 7 / pass 7 / fail 0`；`node scripts/workflow-check.mjs` 无发现。
- `node scripts/rule-checks.mjs size origin/main` 与 `disclosure origin/main` 通过，`git diff --check origin/main...HEAD` 退出 0；`git diff --numstat origin/main...HEAD` 的 code 合计 114 行，低于 `Global Constraints` 的硬停线，文档远低于 1300；这是观察时刻快照，最终行数以该命令重算为准。
- 本计划 lint 输出 `OK: ExecPlan passed lint checks.`；`plan-facts-consistency` 与 `content-placement` 两个文档契约为 `tests 9 / pass 9 / fail 0`。
- 人工五类目（凭据、本机路径与身份、账号与个人信息、内部系统、保密字样）：对相对 base 的新增行与提交作者逐项检查，无命中；提交作者使用既有 GitHub no-reply 邮箱。

独立验收复跑（观察时刻 2026-10-01 17:50 CST；检出 `fix/repository-identity` 的工作树根，代码与 `fe4d980` 相同，验收只追加文档提交；变异、旧代码复现与旧库探针在同一代码的一次性 detached 检出上做）：窄组 `tests 156 / pass 156 / fail 0`，typecheck 退出 0，boundaries `tests 8 / pass 8 / fail 0`，`pnpm verify` 退出 0（`tests 918 / pass 918 / fail 0`，mvp0 `tests 7 / pass 7 / fail 0`），size、disclosure、`git diff --check`、lint、两个文档契约（`tests 9 / pass 9 / fail 0`）与 `node scripts/workflow-check.mjs` 通过。旧生产代码（`git checkout 6c7800b -- packages`）配最终测试集为 `tests 149 / pass 126 / fail 23`，失败原因与本节「RED→GREEN 记录」一致。独立对抗验证的 27 项变异（本节两轮变异实验的全部类别，另有 parser 拒绝 `repository`、接纳 `ProjectV2Item` 或大小写不敏感，适配器把未知种类归一成 `issue`，守卫放到写入之后，替身的 `findExternalIdentity` 忽略种类，`seedExecutionPrereqs` 还原成 `branch`）逐项先以 `git diff -U0` 证明已应用，再跑窄组与宽组（`node --test tests/contract tests/integration tests/e2e`），随后还原且 `git status --short` 为空：26 项被预期用例抓住，唯一存活的是 `seedExecutionPrereqs` 单独还原成 `branch`（只关夹具真实性，生产代码不变）。删掉任一新增共享用例，或身份同步组的一条既有用例（实测 `listMemberships 按 itemExternalId 升序返回`），`node --test tests/contract/storage-contract.test.js` 都是 `tests 126 / pass 125 / fail 1`（身份面守卫）。旧库探针复跑的观察与 `Surprises & Discoveries` 所记一致。

## Bottom Change Note

Change Note (2026-10-01 12:51 CST)：由两份独立多方案设计合成并重新审查；加入DDL前锁内复判、合法更早前缀、Promise错误契约、完整台账与备份恢复门；独立复核后为非空升级/五处故障/全部prefix矩阵分配280行、连接生命周期矩阵30行，修正分项求和；本次仅spec+plan，修改集见Global Constraints。

Change Note (2026-10-01 12:55 CST)：主控补入已执行的文档验证与发布面证据；未来产品验收保持未完成。

Change Note (2026-10-01 16:40 CST)：按控制计划 D10 订正并完成 A-1/A-2。删去 006、受控 rebuild、DDL 前复判、前缀指纹、备份恢复与非空旧库升级验收：`Global Constraints` 文件表、`Plan of Work`、`Validation and Acceptance`、`Idempotence and Recovery` 换成订正后的有效内容，其余章节就地标注 Superseded 并保留原文；追加三条决策、旧库探针与台账现场计数、红→绿与变异证据；顶部状态改为实施完成待人类评审。

Change Note (2026-10-01 17:25 CST)：独立对抗验证（无 P0/P1）之后的一轮修复。代码侧：身份面字面量台账 `IDENTITY_CASE_COUNTS` 与守卫、未知种类反例补非字符串、capabilities 端口注释；遗留债务 TD-004 登记（脚本与表格式 tracker 不兼容，按表头手工追加）。文字订正：取消项加「已取消」前缀，RED 数字拆成 23 + 1 并补终态重跑数字，易失计数带代码提交，台账数字不再在 Progress 复述，Decision Log 第二条的 ⑥ 只保留已核实的来源并收敛措辞（Django 页面只有 squash、没有 reset），补 SQLite 守卫在已关闭实例上的已知边界。文件集增加 `packages/capabilities/src/storage.ts` 与 `docs/exec-plan/tech-debt-tracker.md`，见 `Global Constraints`。

Change Note (2026-10-01 17:50 CST)：独立验收，未改代码与测试。本计划：Progress 的取消项按仓库既有写法加删除线并追加验收一行；Decision Log 追加验收裁决；`Interfaces and Dependencies` 写入交给 B 的接口、head 回读命令与重跑触发条件，`Concrete Steps` 的 head 回读改为按分支名；`Outcomes & Retrospective` 的行数指针改指 `Artifacts and Notes`，补记文档改动略超目标并写入验收结论；`Artifacts and Notes` 追加验收复跑证据。

Change Note (2026-10-02 CST)：第一轮 MVP 评审修订与归档。代码侧：`tests/contract/storage-contract.test.js` 把断言多重集比对抽成 `missingAssertions`，身份面守卫加 `IDENTITY_ASSERTION_BASELINE`（`suites/storage-identity-membership.js` 的 51 条 `assert.` 文本）；`packages/ui-model/src/types.ts` 注释补 repository。文档侧：顶部状态改为 Completed，验证命令去掉仓库外占位，Progress 追加评审与授权两行，Decision Log 追加错误消息取舍。提交整理：原 4 个提交（`6c7800b`、`fe4d980`、`bf05525`、`a93d572`）与评审修订合成两个交付物——实现与测试一个、计划与台账一个；文中引用的这些 SHA 是整理前 PR 分支上的提交（PR 时间线的 force-push 记录可回看），落到 main 的提交以 rebase merge 回执为准。计划随本 PR 从 `active/` 移入 `completed/`，`docs/README.md` 的索引行同步移到 Completed 表。
