# Storage 原子拒绝 ExecPlan

> 状态：Active · 方案已独立综合，产品实现未开始
> 创建：2026-11-13
> 范围：Closes #424；Refs #201；仅身份／成员约束与投影替换原子拒绝。
> 规范：根 `PLANS.md`；开发流程 `docs/development/workflow.md`。

## Purpose / Big Picture

非法规划投影替换必须明确拒绝，且旧投影、作用域外投影、实体和身份完整保留。Fake 与 SQLite 对缺工作区、缺实体及先合法后非法的混合输入行为一致；空输入也不能掩盖不存在的目标工作区。最小成功证据是共享端口用例从当前 Fake 假接受变成拒绝，并读回整个旧集合不变。

## Context and Orientation

观察基线为 2026-11-13 15:26 SGT 的 `main@5708e1ed`；实施检出为 `test/storage-atomic-rejection`，工作树路径 `.worktrees/storage-atomic-rejection`。共享身份套件已由 `tests/contract/storage-contract.test.js` 自动装配到两个适配器。`MemoryStorage.replacePlanningProjections` 删除 stale 后直接 upsert，缺少单项 `putPlanningProjection` 已有的 workspace/entity 父行检查；SQLite 的替换已在 atomic 内，非空非法输入由 FK 拒绝，空 incoming 则没有 FK 执行机会。

事实：独立设计 A/B 均以旧投影 old、合法实体 valid 和输入 `[valid, missing]` 复现 Fake 接受并丢 old、SQLite 拒绝且保留 old。约束：修复现行合同，不把所有内部 Entity 强制拥有外部 primary；#190 的实体适用边界单独处理，非本项前置。假设：预校验可在现有串行槽内完成，无需全局回滚引擎。当前 Project 选择与 issue 正文候选期别存在差异；本轮按用户选择交付 PR，不裁决哪一份排期过时。

官方依据：[SQLite Transactions](https://www.sqlite.org/lang_transaction.html) 区分语句失败与事务回滚，因此必须读回旧状态；[CREATE TABLE](https://www.sqlite.org/lang_createtable.html) 的 CHECK、NOT NULL、FK 责任各异，负例须只破坏目标约束；[Node assert.rejects](https://nodejs.org/api/assert.html#assertrejectsasyncfn-error-message) 的字符串参数只是失败说明，新负例必须 await 并使用正则或校验函数匹配真正拒绝。

## Design / Spec

采用 A/B 共同的“先验证全集、再变更”方案。Fake 用一个局部同步父行校验供 put 和 replace 复用，在既有 `#mutate` 槽内检查目标工作区和全部 entity 后才删旧／upsert；不得在槽内调用再次排队的 public put。SQLite 在现有 atomic 槽内先检查 scope workspace，以覆盖空输入。方法参数 workspace 是落库作用域；Fake 的保存记录按该参数规范化，与 SQLite 一致，不借此新增 binding 挂载或 EntityKind/contentKind 配对规则。

放弃逐项 public put 套 transaction：引入嵌套队列和中间状态；放弃改造所有 Fake mutate 为通用回滚器：扩大架构职责。设计 B 建议的 SQLite scope 检查是必要补充，设计 A 的纯 Fake 修复不能单独满足空输入拒绝。沿用现有会员替换 scope 预检和 #337 后项获胜；已有同 id 跨 domain、禁用默认和自然键证据不复制。

SQL 仅补 002 的缺失行为：enabled/is_default 各自非法数值、disabled default、挂载主键三维、projection 工作区 FK 与双元键、redacted 标题／source number、field value NOT NULL。各坏输入其它字段与父行合法，匹配目标 CHECK／FK／NOT NULL／UNIQUE 错误；已有正控直接复用。只有原先缺出处的 planning-enabled index 增加自身注释，DDL 语义不变。不变量为单 Planning 源、显式身份关联、Host 权威、拒绝零部分写入与作用域隔离。

## Global Constraints

本 PR 唯一允许写入集合如下；`docs/README.md` 索引由协调者最后串行添加，各实现者不写。

| 文件 | 责任 |
|---|---|
| `packages/providers/fake/src/storage.ts` | 仅投影父行预检与参数作用域保存，独占生产 owner |
| `packages/storage/sqlite/src/storage.ts` | 仅 replacement atomic 内目标工作区检查 |
| `packages/storage/sqlite/migrations/002_identity_membership.sql` | 仅 planning-enabled index 出处注释 |
| `tests/contract/suites/storage-identity-membership.js` | 两适配器共享拒绝与完整集合读回 |
| `tests/integration/identity-membership-schema.test.js` | 002 独立 SQL 拒绝与键作用域证据 |
| `docs/exec-plan/active/2026-11-13-storage-atomic-rejection.md` | 本活计划；完成后同名移到 completed |

技术增删预计 260–460 行（生产约 20–55）；文档预计 110–170 行。技术严格小于 800、文档小于 1300，删除与 SQL 注释均计入；超过预计先简化或重新划分闭环，不删除有效安全证据压线。无新依赖、公开接口、schema/data migration、旧实验兼容或用户数据库操作；不改共享装配器、公共 fixture、003、同步／关系实现、Planning Status、期别或原生依赖。不合并 PR。

## Plan of Work

### Batch 1 · 原子拒绝与独立约束闭环

最小闭环是坏集合拒绝后完整旧状态不变。主文件为共享身份套件和两个 adapter 投影写入实现，SQL 证据使用 Global Constraints 指定的 002 集成文件。

### Concrete Steps

先由协调者为计划提交建立 draft PR，使用 `Closes #424`、`Refs #201`，回读 base/head、draft、closing issue 后才写产品代码。保持当前文件 owner，按以下证据顺序实施：先添加 missing workspace（含空集合）、missing entity、valid 在前 invalid 在后的共享反例。初始集合含应被替换的 scoped old、scope 外行及稳定身份，拒绝后 deepEqual 完整集合与身份，而非只数行；对 membership 仅补现有 scope 预检尚未辨认的 mixed／missing 情形。保存 Fake 红、SQLite 非空场景绿的证据，再做两处最小修复和必要 SQL 负例。

在本分支工作树根目录只定义以下验证入口，后续章节引用编号，不重复展开：

    V1: pnpm test:file tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js tests/integration/execution-relation-write-schema.test.js
    V2: pnpm run typecheck
    V3: pnpm run boundaries
    V4: node scripts/rule-checks.mjs disclosure origin/main
    V5: node scripts/rule-checks.mjs size origin/main
    V6: git diff --check origin/main...HEAD
    V7: gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup

V1–V3 修复后期望全部 pass；V4–V6 无违规且人工复算满足更严的 800/1300 限制。V7 由所在分支解析 PR，期望 base 为 main、issue 恰为本叶子、最终 head 的 Fast Gate 通过；协调者另外回读 review threads。变更未提交时用当前工作树 diff 检查同一五类发布面，不能以 V4 的 HEAD 范围冒充未提交扫描。选择新增父行 guard、单个新 SQL 约束做临时移除反证，必须确认对应失败名／错误类别，逐个按原文字节恢复后 V1 回绿；已有充足证据不重复变异，无固定配额。回滚点为本独立 PR；任何生产语义扩大先更新本计划。

## Validation and Acceptance

通过 Batch 1 的 V1–V3，证实两个 adapter 对全部约定非法 replacement 拒绝，完整旧集合与 scope 外事实不变，合法替换仍能删除 stale 且不删实体／身份。SQL 新负例每次只坏一个条件；临时反证归因正确且恢复后绿。最终整理成可独立审阅提交，V4–V7 与人工五类发布面审查完成后才 Ready。该交付不代表父 #201、#190、安装产品或 R1 人类验收完成；跨 PR 的全量组合验证由协调者统一执行。

## Progress

- [x] (2026-11-13 15:26 SGT) 完整读取根规范、实际实现、issue 与两份独立设计，完成第三方取舍。
- [ ] (2026-11-13 15:26 SGT) draft PR 创建并回读 issue 关联；执行 Batch 1、独立复评和最终 head 验证。
- [ ] (2026-11-13 15:26 SGT) 验收完成后填写实际结果、同名归档并由协调者更新索引。

## Surprises & Discoveries

绿色相关基线仍漏掉 Fake 的混合 replacement 破坏旧集合；拒绝本身也不足以证明原子性。空 incoming 不执行 INSERT，SQLite 不能依赖外键偶然检查 workspace；这解释了为何本闭环需要一个明确的队列内 scope 检查。Fake 实际文件名是 `storage.ts`，不是泛称的 Fake.ts。

## Decision Log

Decision：采用全集预校验和 SQLite empty-scope 检查，拒绝全局事务重构。Rationale：覆盖已复现失败和无 INSERT 的真实漏洞，保持单 owner 与既有队列。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

Decision：不改排期、Status 或依赖，不合入 #190。Rationale：本轮明确授权三个独立工程闭环，内部实体外部身份问题不影响当前父行拒绝。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

## Idempotence and Recovery

测试使用临时 SQLite 与内存实例，可重复执行；不访问用户数据库。反证前保存原文字节，finally 恢复并核对字节及 diff，不用 checkout 覆盖其它工作。失败时只回退本批文件；交付后整体 revert 本 PR，不需迁移或删除数据。归档前审阅 `docs/exec-plan/tech-debt-tracker.md`：本设计没有有意新增债务；#190/#337 是既有独立责任，不借本 PR 重新登记。新发现而明确延后的正确性缺口先写本计划并由协调者安排独立 debt/issue，不静默通过。

## Interfaces and Dependencies

需要 Node >=22、pnpm 10.28.2 和已安装 workspace 依赖；安装缺失时按仓库冻结 lockfile 流程恢复。Storage 端口签名、schema generation 和命名保持。GitHub 写入使用已授权 draft/ready 工作流，actor、目标仓库／ProviderBinding、幂等键和结果由协调者记录；计划者本轮没有外部写入。

## Outcomes & Retrospective

当前只交付可执行计划，产品修改与实际验证尚未执行；实施者应在同一计划填写当前 head、测试结果和偏差，未跑项如实保留未完成。

### Artifacts and Notes

证据只保存必要的 red→restore→green 摘要及当前 PR 回读结果，不提交临时变异输入、历史数字配额或实现镜像。相关现行合同由代码与本计划共同给出，仓库外设计报告不作为执行前置。

## Bottom Change Note

Change Note (2026-11-13 15:26 SGT)：综合两份独立方案并核对当前源码，建立单 owner、小范围的 #424 原子拒绝实施计划；加入空集合工作区检查与实际失败后完整状态验收。
