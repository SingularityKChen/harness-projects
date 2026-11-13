# Storage 原子拒绝 ExecPlan

> 状态：Completed · 原主审 R2 复审通过；按人类本轮授权执行最终发布门禁与 rebase 合并
> 创建：2026-11-13
> 范围：Closes #424；Refs #201；仅身份／成员约束与投影替换原子拒绝。
> 规范：根 `PLANS.md`；开发流程 `docs/development/workflow.md`。

## Purpose / Big Picture

非法规划投影替换必须明确拒绝，且旧投影、作用域外投影、实体和身份完整保留。Fake 与 SQLite 对缺工作区、缺实体及先合法后非法的混合输入行为一致；空输入也不能掩盖不存在的目标工作区；外层事务捕获拒绝后正常提交仍须保留旧状态。最小成功证据是共享端口用例从当前 Fake 假接受变成拒绝，并读回整个旧集合不变。

## Context and Orientation

观察基线为 2026-11-13 15:26 SGT 的 `main@5708e1ed`；实施检出为 `test/storage-atomic-rejection`，工作树路径 `.worktrees/storage-atomic-rejection`。共享身份套件已由 `tests/contract/storage-contract.test.js` 自动装配到两个适配器。`MemoryStorage.replacePlanningProjections` 删除 stale 后直接 upsert，缺少单项 `putPlanningProjection` 已有的 workspace/entity 父行检查；初始根实例观察中 SQLite 的替换已在 atomic 内，非空非法输入由 FK 拒绝，空 incoming 则没有 FK 执行机会。Superseded 假设：由此推断非空 replacement 已足够原子；第一轮独立评审 F1 证实 scoped atomic 不自开事务，调用者捕获拒绝后会提交此前部分写入。

事实：独立设计 A/B 均以旧投影 old、合法实体 valid 和输入 `[valid, missing]` 复现 Fake 接受并丢 old、SQLite 拒绝且保留 old。约束：修复现行合同，不把所有内部 Entity 强制拥有外部 primary；#190 的实体适用边界单独处理，非本项前置。已验证：两个适配器均可在现有串行槽内完成全部父行预校验，无需全局回滚引擎。当前 Project 选择与 issue 正文候选期别存在差异；本轮按用户选择交付 PR，不裁决哪一份排期过时。

官方依据：[SQLite Transactions](https://www.sqlite.org/lang_transaction.html) 区分语句失败与事务回滚，因此必须读回旧状态；[CREATE TABLE](https://www.sqlite.org/lang_createtable.html) 的 CHECK、NOT NULL、FK 责任各异，负例须只破坏目标约束；[Node assert.rejects](https://nodejs.org/api/assert.html#assertrejectsasyncfn-error-message) 的字符串参数只是失败说明，新负例必须 await 并使用正则或校验函数匹配真正拒绝。

官方依据补充：[SQLite Savepoints](https://www.sqlite.org/lang_savepoint.html) 说明 ROLLBACK TO 只退回保存点而不取消外层事务，内部 RELEASE 也不单独落盘；这与本轮公共端口反例的恢复目标一致。

## Design / Spec

修订（2026-11-13 17:18 SGT）：前次仅父行预检的充分性已被 review 5888403871 推翻。合法父行 `[valid, sourceNumber.number=0]` 仍在 DELETE 后编码失败；只提前编码又无法回退 SQLite 原生 NOT NULL／CHECK 拒绝。采用现有 `atomic` scoped 分支的同步 SAVEPOINT，失败仅回退本次操作并保留外层成功写入；Fake 的 put／replace 首次修改前共用 domain.sourceNumberSnapshot 校验全集。无需新增队列、公开事务 API 或镜像 SQL 校验器。

采用 A/B 共同的“先验证全集、再变更”方案。Fake 用一个局部同步父行校验供 put 和 replace 复用，在既有 `#mutate` 槽内检查目标工作区和全部 entity 后才删旧／upsert；不得在槽内调用再次排队的 public put。SQLite 在现有 atomic 槽内先检查 scope workspace 和全部 incoming entity，以同时覆盖空输入及事务内捕获拒绝后提交。FK 保留为库约束，不作为该端口的前置原子性证明。方法参数 workspace 是落库作用域；Fake 的保存记录按该参数规范化，与 SQLite 一致，不借此新增 binding 挂载或 EntityKind/contentKind 配对规则。

放弃逐项 public put 套 transaction：引入嵌套队列和中间状态；放弃改造所有 Fake mutate 为通用回滚器：扩大架构职责。设计 B 建议的 SQLite scope 检查是必要补充；独立评审 F1 进一步要求同槽内全部 entity 预检。设计 A 的纯 Fake 修复不能单独满足空输入或 caught transaction 拒绝后零写入。沿用现有会员替换 scope 预检和 #337 后项获胜；已有同 id 跨 domain、禁用默认和自然键证据不复制。

SQL 仅补 002 的缺失行为：enabled/is_default 各自非法数值、disabled default、挂载主键三维、projection 工作区 FK 与双元键、redacted 标题／source number、field value NOT NULL。各坏输入其它字段与父行合法，匹配目标 CHECK／FK／NOT NULL／UNIQUE 错误；已有正控直接复用。只有原先缺出处的 planning-enabled index 增加自身注释，DDL 语义不变。不变量为单 Planning 源、显式身份关联、Host 权威、拒绝零部分写入与作用域隔离。

## Global Constraints

本 PR 唯一允许写入集合如下；`docs/README.md` 索引由协调者最后串行添加，各实现者不写。

| 文件 | 责任 |
|---|---|
| `packages/providers/fake/src/storage.ts` | 投影父行／内容校验与参数作用域保存，独占生产 owner |
| `packages/storage/sqlite/src/storage.ts` | 保留 replacement 既有父行预检 |
| `packages/storage/sqlite/src/storage-sync.ts` | scoped atomic 的操作级回退；无新事务引擎 |
| `docs/review/pr-628-mmp-review.md` | 保留原独立评审与 owner 修复回传证据 |
| `packages/storage/sqlite/migrations/002_identity_membership.sql` | 仅 planning-enabled index 出处注释 |
| `tests/contract/suites/storage-identity-membership.js` | 两适配器共享拒绝与完整集合读回 |
| `tests/integration/identity-membership-schema.test.js` | 002 独立 SQL 拒绝与键作用域证据 |
| `docs/exec-plan/completed/2026-11-13-storage-atomic-rejection.md` | 本活计划；完成后同名移到 completed |

最终规模由 V5 回读，技术严格小于 800、文档小于 1300，删除与 SQL 注释均计入；不把初始估算当作当前规模，不删除有效安全证据压线。无新依赖、公开接口、schema/data migration、旧实验兼容或用户数据库操作；不改共享装配器、公共 fixture、003、同步定序／关系实现、Planning Status、期别或原生依赖。不合并 PR。

## Plan of Work

本轮补充：保持同一工作空间和队列，在 scoped atomic 同步执行 SAVEPOINT／RELEASE，任一失败 ROLLBACK TO＋RELEASE 后重新抛出原异常，并恢复进入操作前的 dirty。Fake 在共享前置校验内调用现有域函数。禁止以仅 sourceNumber 的 SQL 前置特例替代操作回退，禁止复制整套 SQL 约束到 Fake。

### Batch 1 · 原子拒绝与独立约束闭环

最小闭环是坏集合拒绝后完整旧状态不变。主文件为共享身份套件和两个 adapter 投影写入实现，SQL 证据使用 Global Constraints 指定的 002 集成文件。

### Concrete Steps

先由协调者为计划提交建立 draft PR，使用 `Closes #424`、`Refs #201`，回读 base/head、draft、closing issue 后才写产品代码。保持当前文件 owner，按以下证据顺序实施：先添加 missing workspace（含空集合）、missing entity、valid 在前 invalid 在后的共享反例。初始集合含应被替换的 scoped old、scope 外行及稳定身份，拒绝后 deepEqual 完整集合与身份，而非只数行；对 membership 仅补现有 scope 预检尚未辨认的 mixed／missing 情形。保存 Fake 红、SQLite 非空场景绿的证据，再做两处最小修复和必要 SQL 负例。现有每种 projection 负例复用到 direct 与 caught transaction 两种调用路径；事务内 await 拒绝后正常提交，再读回完整旧状态。

在本分支工作树根目录只定义以下验证入口，后续章节引用编号，不重复展开：

    V1: pnpm test:file tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/storage-committed-read-fence.test.js tests/integration/storage-sync-surface.test.js
    V2: pnpm run typecheck
    V3: pnpm run boundaries
    V4: node scripts/rule-checks.mjs disclosure origin/main
    V5: node scripts/rule-checks.mjs size origin/main
    V6: git diff --check origin/main...HEAD
    V7: gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup

V1–V3 修复后期望全部 pass；V4–V6 无违规且人工复算满足更严的 800/1300 限制。V7 由所在分支解析 PR，期望 base 为 main、issue 恰为本叶子、最终 head 的 Fast Gate 通过；协调者另外回读 review threads。变更未提交时用当前工作树 diff 检查同一五类发布面，不能以 V4 的 HEAD 范围冒充未提交扫描。选择新增父行 guard、单个新 SQL 约束做临时移除反证，必须确认对应失败名／错误类别，逐个按原文字节恢复后 V1 回绿；已有充足证据不重复变异，无固定配额。回滚点为本独立 PR；任何生产语义扩大先更新本计划。

## Validation and Acceptance

前轮父行路径结论已由 review 5888403871 限定其适用范围；本轮需同时验证编码与原生 SQL 拒绝。通过 Batch 1 的 V1–V3，证实两个 adapter 对约定非法内容 replacement 拒绝，完整旧集合与 scope 外事实不变，合法替换仍能删除 stale 且不删实体／身份。SQL 新负例每次只坏一个条件；临时反证归因正确且恢复后绿。最终整理成可独立审阅提交，V4–V7 与人工五类发布面审查完成后才 Ready。该交付不代表父 #201、#190、安装产品或 R1 人类验收完成；跨 PR 的全量组合验证由协调者统一执行。

## Progress

- [x] (2026-11-13 17:18 SGT) 合法父行坏内容与原生 SQL 失败已修复；独立复评通过并归档；提交、精确 lease 发布与回传按 V7 实时回读执行，不合并。

- [x] (2026-11-13 15:26 SGT) 完整读取根规范、实际实现、issue 与两份独立设计，完成第三方取舍。
- [x] (2026-11-13 15:40 SGT) 按协调者 handoff 确认 draft PR #628 已建立，main base 与 #424 双向关联已回读，随后执行授权实现。
- [x] (2026-11-13 15:40 SGT) Batch 1 按 red→green 实现；V1 300/300、V2 typecheck、V3 boundaries 9/9 通过；临时反证均在原字节恢复后回绿。
- [x] (2026-11-13 15:51 SGT) 修复第一轮独立评审 F1／F2：SQLite 全集实体预检；补 direct／caught transaction 共享证据与 retained 非空字段；本轮 V1 300/300、V2、V3 9/9 通过。
- [x] (2026-11-13 16:11 SGT) 独立方案、实施与对抗验收／复评均完成，P0–P3 无剩余发现。Superseded by 本轮 review 5888403871：唯一 P1 仍待修复复评。
- [x] (2026-11-13 16:11 SGT) 同名归档并更新独立索引；最终提交与 Ready 仍按本计划远端回读门禁执行。

## Surprises & Discoveries

review 5888403871 的 F1 已复现：共享新增坏编号批次在修复前 Fake 假接受、SQLite caught 提交半批，各一例 RED；另以现有 SQL NOT NULL 的 revision=null 证明预编码不等于操作原子性。原生 SQL 拒绝、外层前后写入保留及仅回滚操作不推进 fence 已作为独立集成反例。修复后的扩展 V1 为 342/342，typecheck 与 boundaries 9/9 通过；本轮全量 4059/4059，独立复评 PASS，实际结果见 Outcomes。

绿色相关基线仍漏掉 Fake 的混合 replacement 破坏旧集合；拒绝本身也不足以证明原子性。空 incoming 不执行 INSERT，SQLite 不能依赖外键偶然检查 workspace；这解释了为何本闭环需要一个明确的队列内 scope 检查。Fake 实际文件名是 `storage.ts`，不是泛称的 Fake.ts。

实际 red：新增共享用例初跑 270 项中 6 项失败。Fake 的四种非法 replacement 均未拒绝，参数 workspace 正控落错位置；SQLite 只有 empty missing workspace 未拒绝，非空三类负例已由 FK 拒绝。直接探针另确认 Fake 接受 `[valid, missing]` 后旧 `old` 被删。SQL 新行为在既有 DDL 下已通过，无需修改约束语义。

## Decision Log

Decision（2026-11-13 / 人类验收范围澄清）：发现 #144/#224/#537 的未完范围后，人类选择“先完成合并和验收，未完项保持打开”。本轮只核对当前交付与人类证据，不实现这些剩余范围；#201 额外缺失的持久回归要求也如实保留。该澄清取代对点名父项无条件关闭的解读。

Decision（2026-11-13 / 人类本轮直接指令）：用户要求“继续 rebase 流程。之后验收并关闭 #144、#224、#201、#537”。#628 原 P1 已经两位独立子评审和主审确认解决，R2 review 5889020218 为 APPROVE。按本授权整理复审记录、当前 head 发布与独立复核后执行 rebase 合并；四项 issue 在合并后的 main 另行验收，不代写 Planning Status 或原生关系。本决定取代本计划旧“不合并”执行边界，旧文本保留为当轮历史。

Decision：P1 由原 owner 接回，采用 scoped atomic SAVEPOINT 与 Fake 现有域校验。Rationale：只提前编码不能涵盖原生 SQL 拒绝，统一入口的小回退边界覆盖实际根因，避免逐坏值添 guard。Date/Author：2026-11-13 17:18 SGT / 原 owner。

Decision（SQLite 只做 empty-scope 的充分性已 Superseded，见 F1 修订）：采用全集预校验和 SQLite empty-scope 检查，拒绝全局事务重构。Rationale：覆盖已复现失败和无 INSERT 的真实漏洞，保持单 owner 与既有队列。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

Decision：不改排期、Status 或依赖，不合入 #190。Rationale：本轮明确授权三个独立工程闭环，内部实体外部身份问题不影响当前父行拒绝。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

Decision：实现只增加局部同步父行预检并复用到 put／replace；SQLite 首轮只补 atomic 内 workspace 检查（该范围已由 F1 修订为全部父行预检）。Rationale：预检全部发生在首次状态修改之前；保持一个既有排队槽，不调用 public put、不新增通用事务或 validator。Date/Author：2026-11-13 15:40 SGT / Batch 1 实施者。

Decision：自审复用原有 membership scope 用例及 projection 双元键用例，不复制同 id 跨 domain、默认槽、natural key 与合法 stale 删除的既有充分覆盖。Rationale：新增证据只覆盖 mixed／missing 及实际错误类别；membership 的合法前项刻意修改 timestamp，以发现部分写入。Date/Author：2026-11-13 15:40 SGT / Batch 1 实施者。

Decision：接受独立评审 F1／F2 并就地修正非空 SQLite 原子性假设；在现有 atomic 槽首次 DELETE 前预检全部实体，复用现有负例覆盖捕获拒绝后正常 commit。Rationale：真实公共端口反例复现 missing／mixed 在 SQLite 丢 old、保留合法前项；只依赖 FK 和外层事务不足。member snapshot 增加 retained item1 非空字段及其前置正控，不新增矩阵或通用回滚器。Date/Author：2026-11-13 15:51 SGT / Batch 1 实施者。

## Idempotence and Recovery

测试使用临时 SQLite 与内存实例，可重复执行；不访问用户数据库。反证前保存原文字节，finally 恢复并核对字节及 diff，不用 checkout 覆盖其它工作。失败时只回退本批文件；交付后整体 revert 本 PR，不需迁移或删除数据。归档前审阅 `docs/exec-plan/tech-debt-tracker.md`：本设计没有有意新增债务；#190/#337 是既有独立责任，不借本 PR 重新登记。新发现而明确延后的正确性缺口先写本计划并由协调者安排独立 debt/issue，不静默通过。

## Interfaces and Dependencies

需要 Node >=22、pnpm 10.28.2 和已安装 workspace 依赖；安装缺失时按仓库冻结 lockfile 流程恢复。Storage 端口签名、schema generation 和命名保持。GitHub 写入使用已授权 draft/ready 工作流，actor、目标仓库／ProviderBinding、幂等键和结果由协调者记录；计划者本轮没有外部写入。

## Outcomes & Retrospective

前次 Completed／无剩余发现结论已被 review 5888403871 的 F1 推翻；前次 4056 项组合验证仅为旧树历史证据，不覆盖该失败点。本轮在检出 `test/storage-atomic-rejection`、以 `main@f32ad6c2` 为基线的工作树执行，未修改 #629/#630 分支。

实际 TDD：新增共享合法父行坏编号批次在修复前 Fake 假接受、SQLite caught 后部分提交，两例 RED；原生 SQL revision=null 拒绝点另有一例 RED。SQLite 唯一 atomic 入口的 scoped 分支现以同步保存点回退本次操作，保留外层已有与后续写入，重新抛出原异常；成功 RELEASE 才标 dirty，失败恢复此前 dirty。Fake 的 put／replace 在首次修改前复用域内原生编号校验，不复制 SQL 全部规则。

扩展 V1 342 passed，V2 类型检查及 V3 boundaries 9/9 通过；完整 `pnpm verify` 通过 contract 1580、integration 2253、e2e 226，共 4059 passed，零失败／跳过。独立复评另跑 325 项定向测试和 12 组公共端口探针，覆盖两个适配器的 direct／caught 坏编号、put 拒绝、合法编号正控、SQLite NOT NULL／CHECK 拒绝、事务前后 marker、同事务合法恢复及 fence。13 个 atomic 调用回调实际均同步。Spec 与 Quality 均 PASS，无新增或剩余 P0–P3 发现。

本轮未新增技术债、schema/data migration、公开接口或第二套校验权威。原 GitHub REQUEST_CHANGES 和 inline 线程保持待主审复审；owner 的独立自验不代替原评审会话对新 head 的批准。最终 head/base/checks、双向 issue 关联及精确 lease 发布结果按 V7 回读并交回原主审，不合并。

### Artifacts and Notes

本计划与 `docs/review/pr-628-mmp-review.md` 保存可复跑入口、初始评审和 owner 修复证据；临时探针日志不成为仓库外前置。

## Bottom Change Note

Change Note (2026-11-13 15:26 SGT)：综合两份独立方案并核对当前源码，建立单 owner、小范围的 #424 原子拒绝实施计划；加入空集合工作区检查与实际失败后完整状态验收。

Change Note (2026-11-13 15:40 SGT)：记录最小预检实现、真实红绿结果和恢复反证；保持 Active，独立最终验收与远端交付由协调者收口。

Change Note (2026-11-13 15:51 SGT)：按独立评审 F1／F2 修正 scoped atomic 假设、补 SQLite 全集实体预检与非空 retained 字段证据；首轮全量仅记为历史 WIP 证据，当前独立复评 pending。 Superseded by Progress（2026-11-13）：该时点待复评状态已由最终独立验收通过取代。

Change Note (2026-11-13 16:11 SGT)：独立复评通过后收敛实际结果、清除待验状态并归档，保持最终远端交付门禁为可回读规则。

Change Note (2026-11-13 16:15 SGT)：补充三个独立 PR 的完整组合与 4056 项全量证据，确认最终产品源码与已验证组合一致。

Change Note (2026-11-13 17:18 SGT)：外部完整评审推翻完成裁决，重开同一计划；记录两个实际反例与最小机制修复范围，保留旧证据为历史。

Change Note (2026-11-13)：实现唯一 atomic 入口的局部保存点和 Fake 现有域校验，补出编码及原生 SQL 两类失败的实际红绿证据。

Change Note (2026-11-13 17:27 SGT)：唯一 P1 的编码与原生 SQL 两类反例修复，经完整验证与独立对抗复评通过后归档；原主审批准仍单独保留。

Change Note (2026-11-13)：纳入原主审 R2 与人类继续 rebase 授权，规模改为最终命令回读；保留归档状态，点名父项验收按合并后实际证据处理。

Change Note (2026-11-13)：验收调查发现父项仍有明确缺口；人类选择“先完成合并和验收，未完项保持打开”，本轮不扩为父项剩余功能实现，也不以子项完成关闭父项。
