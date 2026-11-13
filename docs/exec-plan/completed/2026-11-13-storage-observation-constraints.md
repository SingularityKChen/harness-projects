# 观察定序与关系约束证据 ExecPlan

> 状态：Completed · 实现与独立本地验收通过；远端交付按本计划门禁回读
> 创建：2026-11-13
> 范围：Closes #425；Refs #201；补当前观察／控制事实独立证据。
> 规范：根 `PLANS.md`；开发流程 `docs/development/workflow.md`。

## Purpose / Big Picture

当前观察三维主体和关系约束有足够且有判别力的行为证据，普通重构无需维护历史 SQL 文本或测试数量。成功意味着两个 adapter 的各主体版本独立推进、同版本新观察被接受并保留原始账本、真正非法关系和缺失必填值被对应约束拒绝；已退役的旧完整快照不重建。

## Context and Orientation

观察基线为 2026-11-13 15:26 SGT 的 `main@5708e1ed`；执行检出 `test/storage-observation-constraints`，工作树 `.worktrees/storage-observation-constraints`。`recordObservation` 按 `(bindingId, objectKind, externalId)` 分组比较规范 sourceVersion，按 `(bindingId,dedupeKey)` 去重。SQLite 当前只消费 `committed_observation_version` 的三维 `MAX(updated_at)`，所有成功入账状态都参与版本门槛；同版本不同 key 追加，不提供“选中哪个完整 payload”的公开读口。

事实：`tests/contract/storage-contract.test.js` 已覆盖 kind 隔离、跨 binding 同 key、缺版本；共享同步套件已有同版本／旧版本；SQLite sync 集成已有跨 binding 版本和原始 payload。`docs/exec-plan/completed/2026-11-11-source-version-contract.md` 记录 #623 已退役未消费的完整快照视图。假设：现有生产行为正确，本 PR 默认生产零改动；新反例若证实缺陷，先向对应架构 owner 交接最小证据，不另开第二实现。

官方依据：[SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html) 明确各约束独立且 CHECK 对 NULL 不等同拒绝；[Foreign Keys](https://www.sqlite.org/foreignkeys.html) 要求有效连接启用及合法父键，因此使用真实 DB 的单坏字段负例；[Google Testing Blog](https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html) 支持公共行为优于私有实现镜像。本轮按当前 Project 用户选择交付工程 PR，正文候选期别差异不构成改排期授权。

## Design / Spec

采用设计 B 的现有共享套件扩充，舍弃设计 A 的新增独立 adapter 装配文件：复用既有 Fake/SQLite 注册与临时库生命周期，减小维护面。只补缺少的不同 externalId 和 Fake 跨 binding 版本差；kind、去重和同版本已有证据直接引用。一个小型参数化用例覆盖 pending/processed/ignored/failed 高版本均形成门槛，随后较旧 fresh-key 拒绝；不得改成 processed-only。当前 MAX view 用真实数据及结果核对三维和最大值，不冻结 SQL 源码。

confirmed/candidate 各自以 `source='llm'` 直接拒绝并读回无新增行；candidate 各父边独立断言；两表同端点不同 type 可并存、同完整键拒绝。保留现有来源词表绑定和候选不能 explicit 的证据。新增 DDL 反例只填下表缺口，其余已覆盖目标不复制。词表扩值风险优先复用现有 sqlite_master 取值机制绑定 domain 枚举，不写另一 parser 或手写第二词表。不变量为显式关系权威、三维主体隔离、追加账本、Host 权威及无数据迁移。

原 review 5319934035（PR #157，discussion 4106407168）称“28 存活”，实际具名可枚举 24 个目标（FK10、key5、view2、NOT NULL4、词表3）；以下逐项分组映射原枚举，不伪造其余四项，也不设固定 mutation 配额。

下表证据文件简写：D 为 `tests/integration/execution-relation-write-schema.test.js`，E 为 `tests/contract/suites/storage-execution.js`，C 为 `tests/contract/storage-contract.test.js`，S 为 `tests/contract/suites/storage-sync.js`，I 为 `tests/integration/storage-sync-surface.test.js`。标题前缀均在 V1 实际执行。

| 历史目标 | 当前处理／最少证据 |
|---|---|
| repository workspace／external identity FK（2） | D「独立父边」各一条单坏字段 SQL；E「悬空父边与非法枚举」保留身份父边端口拒绝 |
| execution_context workspace／work item FK（2） | work item：D「已钉住的约束变异」#196 单坏字段 SQL + E「执行上下文：未登记工作项以同结构拒绝」。workspace 直接边的单点删除义务 **Superseded**：合法 repository.workspace 父链 + context 的非空复合 FK 已蕴含它；E「悬空父边与非法枚举」及 D「关系候选分表」的跨 workspace 仓库拒绝保护当前行为，不伪称直接边独立失败 |
| candidate workspace／from FK（2） | D「独立父边」各独立拒绝，同时补同样独立的 to 父边；E「悬空父边与非法枚举」已有三父边端口证据 |
| reconcile／webhook／mutation／revision workspace FK（4） | D「独立父边」四条分别拒绝且无新增行；C「悬空父行的同步游标与对账游标」和 E「悬空父边与非法枚举」继续保留已有端口证据；订阅无独立公开端口 |
| repository UNIQUE(workspace,identity)（1） | E「仓库挂载以 (工作区, id) 为键」；D「仓库身份唯一键包含工作区」同 workspace 双 id 同身份拒绝、跨 workspace 接受 |
| relation／candidate PK 中 type（2） | D「关系完整键包含 type」两表各自同端点不同 type 共存、同完整键拒绝 |
| sync_cursor PK 中 scope（1） | C「同步游标：同连接同scope跨workspace隔离」和 I「游标按作用域隔离」；D「已钉住的约束变异」补同 workspace/binding 两 scope 正控 |
| dedupe index 中 binding（1） | C「同一 dedupeKey 在两个绑定下是两条观察」及 I「观察定序：更旧的版本不落账本，同版本追加并保留原始 payload」，复用且不另写副本 |
| 旧 view rowid tie-break（1） | **Superseded**：#623 随无消费者完整快照退役，当前只消费 MAX 版本；D「当前版本视图按三维主体取 MAX」核对当前三维结果与追加账本，不选完整 payload |
| updated_at 比较 NOCASE（1） | **Superseded**：#203 后规范时间载体定义域内等价，旧 opaque ASCII 大小写反例退役；S「版本载体必须是规范载体」及「规范载体按时间序定序」保留非法载体拒绝与归一后定序 |
| mutation binding／command NOT NULL（2） | D「必填值」分别单列 NULL，其它值合法，使用 addItem 避开专属 fingerprint CHECK |
| observation updated_at／snapshot NOT NULL（2） | D「必填值」分别单列 NULL；C「两条 sourceVersion 缺失」及「空串不是合法版本载体」分层证明 undefined 的空串存储编码合法与端口禁止空载体 |
| execution_run status CHECK 删除／扩值（2） | E「悬空父边与非法枚举」及 D「已钉住的约束变异」拒绝非法运行状态；D「运行状态与关系类别、来源」复用 sqlite_master 机制绑定完整 ExecutionRunStatus |
| relation_class 扩值（1） | D「运行状态与关系类别、来源」两表绑定完整 RelationClass；D「已钉住的约束变异」两表 class 单坏字段，source/state 都合法 |

## Global Constraints

唯一允许写入集合如下；协调者最后串行更新 `docs/README.md`，worker 不写。

| 文件 | 责任 |
|---|---|
| `tests/contract/suites/storage-sync.js` | 缺失主体维度与处理态门槛的双 adapter 行为 |
| `tests/contract/suites/storage-execution.js` | 仅明确 llm 来源拒绝和无新增行证据 |
| `tests/integration/execution-relation-write-schema.test.js` | 当前 DDL 缺口、关系键和 MAX view 数据证据 |
| `docs/exec-plan/completed/2026-11-13-storage-observation-constraints.md` | 本活计划；完成后同名移到 completed |
| `docs/review/pr-629-mmp-review.md` | 当前 MMP 矩阵及独立验收证据 |

生产代码零改动目标；技术增删按实际最小证据交付，不设下限；严格技术小于 800、文档小于 1300，删除与配置均计入。不开新 parser／规则镜像／固定变异台账，不改公共 fixture、装配器、Fake、SQLite 实现、002/003、迁移器或现有安全约束。不恢复旧视图／日志，不触碰用户库、旧实验兼容、Status、期别、依赖或 PR #555 的验收 fixture，不自行合并。

## Plan of Work

### Batch 1 · 当前合同补证据

最小闭环是现有正确行为被有判别力的结果断言保护。主文件为共享同步套件、执行套件和 003 集成证据；按 Global Constraints 独占范围执行。

### Concrete Steps

协调者先建立带本计划的 draft PR（`Closes #425`、`Refs #201`），回读关联与 main base 后才实施。先定位并引用上表已有证据，补真正空缺；每个新 SQL invalid input 只坏一个目标，匹配具体约束错误且不留新行。没有生产 bug 时不虚构 RED：在仅一个副本上临时移除相关主体维度／把 MAX 改 MIN、或移除新补约束，确认对应失败归因后按字节恢复。一次只做一个，已有充分证据不重做历史全套；不提交临时 mutation 产物。

在本分支工作树根目录定义唯一验证入口：

    V1: pnpm test:file tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js tests/contract/storage-contract.test.js
    V2: pnpm run boundaries
    V3: node scripts/rule-checks.mjs disclosure origin/main
    V4: node scripts/rule-checks.mjs size origin/main
    V5: git diff --check origin/main...HEAD
    V6: gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup

V1–V2 期望 pass，定向反证须对应断言红、恢复后 V1 绿。V3–V5 无违规且实际增删满足更严限制；未提交文件另查当前 diff 和人工五类发布面。V6 由所在分支解析 PR，期望最终 head 对应 main、本叶子关联和 Fast Gate 通过；review threads 由协调者另回读。批次回滚为本独立 PR，无持久数据步骤。新机制或 owner 扩大先更新计划，不在测试 PR 偷渡架构修改。

## Validation and Acceptance

Batch 1 的 V1 验证缺失维度独立推进、全部已入账处理态形成当前门槛、同版本追加和原 payload 仍保留；关系 source=llm 与各独立坏父边／必填值被真实约束拒绝。上表每个历史具名目标有现行证据或明确退役理由，不声称重放全部“28”。V2–V6、独立复评与发布面审查通过后才 Ready。协调者统一做最终三 PR 组合验证，不把本项当成父 #201 或 R1 人类验收。

## Progress

- [x] (2026-11-13 15:26 SGT) 完整读当前实现、历史枚举和两份独立设计，综合短计划及退役映射。
- [x] (2026-11-13 15:42 SGT) 协调者已报告 draft PR #629 的 main base 与双向 issue 关联回读；Batch 1 三个测试文件实施完成，生产零改动。
- [x] (2026-11-13 15:42 SGT) baseline V1 294/294；九个按风险选择的单点反证均由对应新断言抓住，原字节恢复后 V1 294/294、V2 9/9。随后拆开两个键行为的测试标题、改进词表缺失诊断，并将 D 文件本地种子的仓库身份校正为 repository；最终 V1 在下方记录。
- [x] (2026-11-13 15:54 SGT) 独立全面评审无 P0/P1；唯一 P2 F1 的退役 SQL 注释句子匹配已删除、测试改名为账本列集及追加／去重责任，定向集成验证 17/17。
- [x] (2026-11-13 16:11 SGT) 独立方案、实施与对抗验收／复评均完成，P0–P3 无剩余发现。
- [x] (2026-11-13 16:11 SGT) 同名归档并更新独立索引；最终提交与 Ready 仍按本计划远端回读门禁执行。

## Surprises & Discoveries

历史“same-version replacement”描述原来指完整快照选择；当前没有该公开消费者，只有版本门槛和原始追加账本。pending／ignored／failed 也参与 MAX，不能因 committed 名称推测只有 processed。原评论计数与具名列表不符，实际可追溯目标数在 Design / Spec 如实处理。

合法 repository 行必须已有 workspace；context 的非空 `(workspace_id, repository_id)` 又必须命中该行。因此移除 context 直接 workspace FK 在当前合法状态域内是等价变异，不能靠同时坏复合 FK 的 ws-none 输入声称它被独立钉住。本轮不关闭 FK 种下非法父状态，也不为杀变异改 schema。首次 baseline 的新视图断言因 SQLite 行对象原型不同而失败，转换结果行原型后通过；这是测试接线修正，不是生产缺陷 RED。

独立评审 F1 发现既有 R4 用例还匹配 SQL 注释的退役“整快照替换”句子；仅改注释便能假红。修复仅删除该过时 match 并把测试标题改成实际列集／追加／去重责任；保留列、真实数据拒绝、现行出处检查，不引入替代 prose regex、不改 003。

## Decision Log

Decision (2026-11-13 / 人类本会话直接指令)：用户点名 PR #628–630，要求无 P0/P1 或只有 P2/P3 时由评审会话收尾，并“`merge_method=rebase` 合并”。本 PR 首轮无新增 P0–P3，由评审会话补记录、整理提交和最终门禁后执行；Planning Status 与原生关系由规划所有者决定。评审证据见 `docs/review/pr-629-mmp-review.md`。

Decision：用现有共享套件补行为，生产零改动；采用 B 的装配复用与 A/B 的历史退役判断。Rationale：当前机制已存在，新增平行装配和旧 view 会增加第二维护面。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

Decision：真实缺陷交 owning 单元处理，不因“测试-only”标签忽略。Rationale：#424 独占 Fake 和 foundation 单元；本 PR 不争用文件，也不擅自建立原生依赖。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

Decision：接受 execution_context.workspace 直接边删除义务的退役，保留合法父链、复合 FK 与端口拒绝证据。Rationale：该边已被合法父状态逻辑蕴含；其它父行必须合法的前提下不存在单独击穿输入，不能伪造单约束失败。Date/Author：2026-11-13 15:42 SGT / 实施者报告，协调者核对 003 后裁定。

## Idempotence and Recovery

临时库和内存测试可重跑。反证保存原文字节并 finally 恢复／核对，只改当前工作树的一处，不使用 checkout 抹掉未提交修复。整个 PR revert 即恢复原证据，无 schema 或数据回滚。计划完成预期无新增技术债；归档前检查 `docs/exec-plan/tech-debt-tracker.md`，实际产生且明确延后的缺口必须登记并更新本计划，不能把退役旧无消费者功能当作新债务。

## Interfaces and Dependencies

需要 Node >=22、pnpm 10.28.2、冻结 lockfile 对应 workspace 依赖；现有 suite adapter 注册、domain 枚举与公开 Storage 端口保持。GitHub draft／ready 由协调者执行并记录 actor、目标仓库／ProviderBinding、幂等键和结果。本项无外部 Provider 行为或用户凭据需求。

## Outcomes & Retrospective

保持生产实现零改动，补齐三维主体及各处理态门槛、控制事实独立约束、关系来源和键的最少证据。V1 295/295、boundaries 9/9 通过；选择性反证和独立 candidate.to FK 反证准确变红并按字节恢复。旧 SQL 句子锁已删除，同一个注释改写探针现在通过，真实列集、账本及约束证据保持。24 个具名历史目标均有当前证据或明确退役／等价说明，不声称重放历史“28”配额。

本项无新增或接受延期技术债；保留既有独立 issue 的责任。最终三 PR 组合验证与远端 head/base/checks、双向 issue 关联、元数据及线程回读由协调者执行并在 PR 的当前证据中记录。Ready 以最终 head 的 PR Fast Gate 和独立验收为条件；不代表父项或 R1 人类接受。

组合验证（2026-11-13 16:15 SGT）：在检出 `test/iteration-constraint-integration` 的工作树根目录，基于 `main@5708e1ed` 组合本批三个 PR 的完整差异，无冲突。`pnpm verify` 通过：contract 1578、integration 2252、e2e 226，共 4056 passed，零失败／跳过；类型检查与包边界 9/9 通过。此后仅补充本结果说明，产品／测试源码保持该组合。

### Artifacts and Notes

规格、反例、恢复和验证入口均在本计划；运行日志为本地临时内容，不成为仓库外前置。

## Bottom Change Note

Change Note (2026-11-13 15:26 SGT)：综合两份方案，收敛到现有套件的缺失行为证据，明确 24 个可枚举历史目标与旧 view／NOCASE 退役理由，锁定与 #424 不重叠的文件 owner。

Change Note (2026-11-13 15:42 SGT)：实施当前合同最小证据；将24具名目标映射到实跑标题，明确直接 workspace 冗余边退役，记录选择性反证、按字节恢复与债务审阅；保留 Active 等待独立验收。

Change Note (2026-11-13 15:54 SGT)：依据独立评审 F1 删除旧整快照注释的文本契约并改正测试责任标题；17条定向集成验证通过，冻结等待同一评审者窄复评。

Change Note (2026-11-13 16:11 SGT)：独立复评通过后收敛实际结果、清除待验状态并归档，保持最终远端交付门禁为可回读规则。

Change Note (2026-11-13 16:15 SGT)：补充三个独立 PR 的完整组合与 4056 项全量证据，确认最终产品源码与已验证组合一致。

Change Note (2026-11-13)：独立 MMP 全矩阵、295项定向和33项归因变异通过；补本 PR 评审记录与用户条件 rebase 授权，保持归档及最终远端回读门禁。
