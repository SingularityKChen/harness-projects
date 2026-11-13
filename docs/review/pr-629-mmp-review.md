# PR #629 MMP 交付评审

## 锁定事实

2026-11-13 首轮：base `main @ 5708e1edca2ea032f02b35c411ee76e29a31ad1c`；head `92feba16bf97171821a589ae47b523b8216f94b5`；检出 `test/storage-observation-constraints`，工作树 `.worktrees/storage-observation-constraints`。评审账号 `Singularity-AI-Bot`；开发账号 `SingularityKChen`。

目标闭环：观察定序及关系约束的判别证据。现有实现会话“梳理迭代紧急重要 Issue”负责三个原分支；P0/P1 交该会话修复，非阻塞收尾由本评审会话承担。用户已在本会话授权无 P0/P1 时逐 PR 修复、复评与 rebase 合并。

## 风险矩阵（逐文件审查前建立）

| 级别 | 候选风险 | 检查与判定门 |
|---|---|---|
| P0 | 破坏 main、泄露凭据或违反规划事实源硬边界 | 无发现；生产零改动，发布面五类人工检查及机械扫描通过 |
| P1 | 三维版本隔离、独立外键与有效父行证据失效 | 无发现；双 adapter 行为、真实 DDL、33 项定向变异归因成立 |
| P2 | 覆盖缺口、维护成本或重复 issue | 无发现；复用装配，新增用例对应独立失败模式；#424/#426 与本项职责分开 |
| P3 | 文档、链接、命名与措辞不准确 | 无发现；计划已归档、索引存在，历史义务有现行证据或退役理由 |

覆盖层：代码、产品闭环、架构边界、测试/反例、issue/ExecPlan 验收、设计充分性与复杂度；以下结论仅对锁定 head 有效。

## 关键证据与结论

结论：固定 head 上无新增 P0–P3。独立审查完成后未修改生产代码、测试、Git refs 或 GitHub；仅更新本记录。方法为 Superpowers（子任务按其 SUBAGENT-STOP 免除引导仪式）、Qian analysis/synthesis 与 First Principles audit。

## Purpose / Big Picture

核验 #425 的观察定序和关系约束判据可独立交付，不将测试通过等同于完整产品或 R1 接受。

## Context and Orientation

目标是判断 #425 的观察定序及关系约束证据能否独立交付。事实源为固定 diff、当前 Storage/Fake/capabilities/domain、原 PR #157 review `5319934035` / discussion `4106407168`、#201/#425 和当前 ExecPlan；不把历史摘要当作当前行为。

## Design / Spec

范围保持三个测试文件与计划/索引；不改变 schema、端口、Host 权威、规划状态、确认/对账或用户库。共享 suites 复用现有 Fake/SQLite 装配，没有新增生产机制、平行装配或第二词表。

| 覆盖层 | 当前源码与证据 |
|---|---|
| 代码/产品 | `storage-sync.js:108` 在第二主体较低、自己更旧、自己更新及首主体更旧四格区分门槛；`:125` 覆盖 pending/processed/ignored/failed。`storage-contract.test.js:180` 已在双 adapter 钉住 kind 隔离；既有同版本新 key 与原 payload 集成证据保留 |
| 架构/所有权 | SQLite `storage-sync.ts:279–306` 只消费三维 MAX view；Fake `storage.ts:510–531` 同主体取最大版本；本 PR 不增事实源或反向依赖 |
| 独立父边/必填值 | `execution-relation-write-schema.test.js:189` 九条裸 SQL 每次只缺一个父行；目标 FK 单独移除即由该用例变红，排除其它坏值掩盖。`:210` 四列各自 NULL、错误匹配目标列，且无新增行 |
| 来源/键 | `storage-execution.js:112` 在合法父行下分别拒绝 candidate/confirmed 的 llm，并给 deterministic 正控；DDL `:172` 绑定完整 domain 枚举。`:226/:236/:267` 保护 type、workspace 与 scope 正反两面 |
| 工作项/复杂度 | #425 三条验收均有证据；#201 仍承担父项，#424/#426 是独立叶子。现有 schema 折叠 #417/#595/#596 不属本闭环；没有发现需重复建 issue 的问题 |

## Global Constraints

子评审仅写本记录，所有源码变异由仓库夹具恢复；主审仅补本记录与已归档计划。无 Planning Status、原生关系或用户数据操作。

## Plan of Work

### Batch 1 · 固定 head 独立审查

按矩阵审读、执行下列最窄验证与归因变异，恢复后再核对源码；最终文档提交后重新锁定远端 head、base、checks 与 threads。

## Validation and Acceptance

执行上下文：`.worktrees/storage-observation-constraints`，head/base 为本文开头的完整 SHA。以下均为本次真实结果，非沿用作者报告：

| 命令 | 实际结果 |
|---|---|
| `pnpm test:file tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js tests/contract/storage-contract.test.js` | `tests 295; pass 295; fail 0; cancelled 0; skipped 0; todo 0` |
| `pnpm run boundaries` | `tests 9; pass 9; fail 0` |
| `node scripts/rule-checks.mjs disclosure 5708e1edca2ea032f02b35c411ee76e29a31ad1c` | exit 0，机械扫描通过；另人工核对完整 diff、commit 与 PR 描述的五类发布面 |
| `node scripts/rule-checks.mjs size 5708e1edca2ea032f02b35c411ee76e29a31ad1c` | exit 0，技术 159/1000、文档 141/1500（固定 PR 差异，不含本评审记录） |
| `git diff --check 5708e1edca2ea032f02b35c411ee76e29a31ad1c...92feba16bf97171821a589ae47b523b8216f94b5` | exit 0，无输出 |
| `node scripts/review-mutate.mjs <runtime-spec.json>` | exit 0；33 项均 `KILLED`，每项显式提供 `killedBy`，基线和还原后基线 exit 0；临时 spec 不入库 |

变异命令复用 V1；下表按相同归因合并行，列出本次整表全部目标。`KILLED` 只在失败名包含 `killedBy` 时成立，未把其它用例红误记为归因。

| 变异目标（数量） | killedBy 用例片段 | 实际结果 |
|---|---|---|
| repository workspace/identity；candidate workspace/from/to；reconcile/webhook/mutation/revision workspace FK（9） | `独立父边` | 9 × RED exit 1 / KILLED |
| mutation binding/command；observation updated_at/snapshot NOT NULL（4） | `必填值` | 4 × RED exit 1 / KILLED |
| 两关系表 source 加 llm、class 加 bogus；execution_run status 扩值/删 CHECK（6） | `运行状态与关系类别、来源` | 6 × RED exit 1 / KILLED |
| 两关系表 PK 去 type（2） | `关系完整键包含 type` | 2 × RED exit 1 / KILLED |
| repository UNIQUE 去 workspace（1） | `仓库身份唯一键包含工作区` | RED exit 1 / KILLED |
| sync_cursor PK 去 scope（1） | `已钉住的约束变异` | RED exit 1 / KILLED |
| MAX→MIN、GROUP BY 分别去三维之一、仅 processed 形成版本（5） | `当前版本视图按三维主体取 MAX` | 5 × RED exit 1 / KILLED |
| Fake 主体分别去 binding/externalId（2） | `主体各自推进版本门槛` | 2 × RED exit 1 / KILLED |
| Fake 主体去 kind（1） | `同一 external_id 在 issue 与 draft 两个种类下各有自己的版本序列` | RED exit 1 / KILLED |
| Fake 仅 processed 形成版本（1） | `全部成功入账的处理态均形成版本门槛` | RED exit 1 / KILLED |
| Fake 来源放行 llm（1） | `LLM 来源不能写入候选或确认关系且不留行` | RED exit 1 / KILLED |

## Progress

- [x] 2026-11-13：先读既有矩阵，再锁定 diff、Issue、源码、全部 review/comments/threads 与 checks。
- [x] 2026-11-13：跑最窄 V1、包边界、发布/规模检查；完成一次最终树上的变异整表及字节恢复。
- [x] 2026-11-13：覆盖全部矩阵后一次性汇总结论；仅交主评审，不向 GitHub 写意见或批准。

## Surprises & Discoveries

原枚举确实为 24 个具名目标（FK10、key5、view2、NOT NULL4、词表3），不是声称的 28。当前计划逐项映射，没有为了凑数量恢复旧 SQL 或计数守卫。

三项退役接受：① `execution_context.workspace` 直接边由合法 repository.workspace 父链及非空复合 FK 蕴含，不制造非法父状态来“杀死”；② 旧完整快照 rowid tie-break 在 #623 已随无消费者视图退役，当前公开口只需最大版本，原 ledger payload 仍保留；③ capabilities 只接受定宽规范 UTC 载体，NOCASE 在有效域内与 BINARY 等价，非法旧 ASCII 反例由入口拒绝。依据为当前 003、Storage reader、`observation.ts:143–159` 与已完成 source-version 计划的消费者台账。

## Decision Log

- 2026-11-13 / 独立子评审：接受上列三项退役；当前机制提供等价边界，保留无消费者的旧模型会增加第二维护面。
- 2026-11-13 / 人类本会话直接指令：无 P0/P1 或只有 P2/P3 时“你负责后续”并“`merge_method=rebase` 合并”；据此由本评审会话收尾 #629，不包含 Planning Status 或原生关系变更。

## Idempotence and Recovery

变异由仓库工具串行施加、finally 按字节恢复，并执行最终基线；不调用 checkout/reset，不动用户数据库。结束后 `git diff` 确认全部变异生产/测试文件与固定 head 一致，工作树仅新增本记录；本记录可单独撤销。Storage 公共接口及依赖不变，#425 工程验收可成立；父项与 R1 人类接受仍单列。

## Interfaces and Dependencies

使用现有 Node/pnpm、冻结依赖和仓库变异夹具。审查/批准账号为 `gh-review`，开发/合并为 `gh`。

## Outcomes & Retrospective

局限：子评审未独立重跑完整 `pnpm verify` 或安装态 UAT；仅读取该 head 的 CI 与作者组合报告。GitHub `PR Fast Gate` 和 CI lanes 为 success；review/comments/threads 均为空。`Create review session` 的本地端点返回 404，已有开放 #364；`Reconcile engineering state` 实际 conclusion 为 cancelled，同全域并发组后继 `43393150453` success。两者不是本 PR 测试回归，仍由主评审最终回读门禁。

主审在基于相同 base、产品/测试文件逐字节等于三个首轮 head 的组合检出上另行运行 `pnpm verify`：1578 contract + 2252 integration + 226 e2e = 4056 passed，0 failed/skipped。没有后续生产/测试修改；该组合证据不替代本矩阵和各叶子 issue 的验收。

## Bottom Change Note

2026-11-13：独立评审覆盖全矩阵、最窄回归及 33 项有归因变异，无新增发现；不执行 GitHub 写入或合并。

2026-11-13：主审补齐 PLANS 章节、直接条件授权及组合实跑证据；最终远端门禁保持可回读。

2026-11-13：交付文档窄复评确认源码/测试保持首轮内容、授权与证据准确；仅将 Progress 归位并补日期，未新增行为变更。
