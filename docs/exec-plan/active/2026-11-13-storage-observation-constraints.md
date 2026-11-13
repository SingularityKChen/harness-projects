# 观察定序与关系约束证据 ExecPlan

> 状态：Active · 独立方案综合完成，产品实现未开始
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

| 历史目标 | 当前处理／最少证据 |
|---|---|
| repository workspace／external identity FK（2） | 复用共享父边证据；仅补缺少的各一条 SQL 坏父行 |
| execution_context workspace／work item FK（2） | work item 已有 #196 SQL 最后防线；workspace 独立缺口补证据 |
| candidate workspace／from FK（2） | 各补一条其它父行合法负例，同时核实已有 to 父边 |
| reconcile／webhook／mutation／revision workspace FK（4） | 已有端口证据引用；裸 SQL 每条未覆盖父边各独立拒绝 |
| repository UNIQUE(workspace,identity)（1） | 共享 port 已有；SQL 同 workspace 双 id 指向同身份拒绝、跨 workspace 合法 |
| relation／candidate PK 中 type（2） | 两表同两端不同 type 共存、同完整键拒绝 |
| sync_cursor PK 中 scope（1） | 复用共享 scope 隔离；必要时补同 workspace/binding 两 scope 正控 |
| dedupe index 中 binding（1） | 现有共享跨 binding 同 key 已覆盖，不新增副本 |
| 旧 view rowid tie-break（1） | #623 随无消费者完整快照退役，当前 MAX 版本无此义务 |
| updated_at 比较 NOCASE（1） | #203 后规范时间载体定义域内等价，旧 opaque ASCII 大小写反例退役；保留非法载体拒绝 |
| mutation binding／command NOT NULL（2） | 其它值合法，分别单列 NULL；使用 addItem 避开专属 fingerprint CHECK |
| observation updated_at／snapshot NOT NULL（2） | 分别单列 NULL；undefined 落空串合法与端口禁止空载体分层证明 |
| execution_run status CHECK 删除／扩值（2） | 复用非法运行状态；核实现有机制绑定完整 domain 枚举，缺失才补 |
| relation_class 扩值（1） | 两表绑定当前 domain 类别；class 负例不能被 source 或 state 先拦 |

## Global Constraints

唯一允许写入集合如下；协调者最后串行更新 `docs/README.md`，worker 不写。

| 文件 | 责任 |
|---|---|
| `tests/contract/suites/storage-sync.js` | 缺失主体维度与处理态门槛的双 adapter 行为 |
| `tests/contract/suites/storage-execution.js` | 仅明确 llm 来源拒绝和无新增行证据 |
| `tests/integration/execution-relation-write-schema.test.js` | 当前 DDL 缺口、关系键和 MAX view 数据证据 |
| `docs/exec-plan/active/2026-11-13-storage-observation-constraints.md` | 本活计划；完成后同名移到 completed |

生产代码零改动目标；技术增删预计 210–400，文档 130–200 行；严格技术小于 800、文档小于 1300，删除与配置均计入。不开新 parser／规则镜像／固定变异台账，不改公共 fixture、装配器、Fake、SQLite 实现、002/003、迁移器或现有安全约束。不恢复旧视图／日志，不触碰用户库、旧实验兼容、Status、期别、依赖或 PR #555 的验收 fixture，不自行合并。

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
- [ ] (2026-11-13 15:26 SGT) draft 关联回读，完成 Batch 1、定向反证与独立复评。
- [ ] (2026-11-13 15:26 SGT) 最终 head 证据齐备，填实际结果、归档并由协调者更新索引。

## Surprises & Discoveries

历史“same-version replacement”描述原来指完整快照选择；当前没有该公开消费者，只有版本门槛和原始追加账本。pending／ignored／failed 也参与 MAX，不能因 committed 名称推测只有 processed。原评论计数与具名列表不符，实际可追溯目标数在 Design / Spec 如实处理。

## Decision Log

Decision：用现有共享套件补行为，生产零改动；采用 B 的装配复用与 A/B 的历史退役判断。Rationale：当前机制已存在，新增平行装配和旧 view 会增加第二维护面。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

Decision：真实缺陷交 owning 单元处理，不因“测试-only”标签忽略。Rationale：#424 独占 Fake 和 foundation 单元；本 PR 不争用文件，也不擅自建立原生依赖。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

## Idempotence and Recovery

临时库和内存测试可重跑。反证保存原文字节并 finally 恢复／核对，只改当前工作树的一处，不使用 checkout 抹掉未提交修复。整个 PR revert 即恢复原证据，无 schema 或数据回滚。计划完成预期无新增技术债；归档前检查 `docs/exec-plan/tech-debt-tracker.md`，实际产生且明确延后的缺口必须登记并更新本计划，不能把退役旧无消费者功能当作新债务。

## Interfaces and Dependencies

需要 Node >=22、pnpm 10.28.2、冻结 lockfile 对应 workspace 依赖；现有 suite adapter 注册、domain 枚举与公开 Storage 端口保持。GitHub draft／ready 由协调者执行并记录 actor、目标仓库／ProviderBinding、幂等键和结果。本项无外部 Provider 行为或用户凭据需求。

## Outcomes & Retrospective

当前只交付计划；代码测试变更、反证和 PR 最终 head 验收未执行。实施者在此填写实际结果与偏差，不能把独立设计基线代替实施 head 结果。

### Artifacts and Notes

只保留当前风险、必要 red→restore→green 摘要和远端回读；不提交历史配额 manifest。完整上下文与官方依据已写入本计划，无仓库外报告前置。

## Bottom Change Note

Change Note (2026-11-13 15:26 SGT)：综合两份方案，收敛到现有套件的缺失行为证据，明确 24 个可枚举历史目标与旧 view／NOCASE 退役理由，锁定与 #424 不重叠的文件 owner。
