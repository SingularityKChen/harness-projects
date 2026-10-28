# 当前 SQLite 基线准入 ExecPlan（#414）

> 状态：Completed（F431-1 修复与独立复评完成）；创建：2026-10-28。远端交付状态按本计划回读命令核对，合并由人类决定。
> 范围：#223 的当前世代准入闭环；不升级历史设计或旧数据。
> 规范：`PLANS.md`。

## Purpose / Big Picture

打开工作区时，完整当前 SQLite 库继续可用；历史版本清单、错误结构与未知用户对象在业务写入前被拒绝，并返回可供界面处理的“先备份、再由用户决定重建”指令。空库一次原子建成当前完整链，失败不留下半成品，两个进程同时启动也只初始化一次。成功证据必须同时来自直接 `migrate`、`createSqliteStorage`、全部行不变快照、真实并发和事务失败测试。

## Context and Orientation

本计划以 2026-10-28 09:14 SGT、`fix/storage-baseline-admission` 检出观察为依据；当时起点为 `4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`。执行证据必须重新记录 `git rev-parse HEAD` 和 base，不能沿用观察值。工作目录统一为检出该分支的工作树根 `.worktrees/storage-baseline-admission/`，所有下述相对路径与命令均从该处解析。

`packages/storage/sqlite/src/migrations.ts` 是当前建库清单，实际为 1–7；005 只有注释，数据步骤位于 `source-version-carrier.ts`。`migrate.ts` 现在认可清单前缀、逐条提交；`storage.ts` 工厂先调用旧 `assert002Shape`，之后才迁移。因此仅在工厂末尾加守卫不能保护直接入口，也不能统一错误。`db.ts` 在事务外启用外键及五秒忙等待。`schema_migrations` 是版本账本，不足以证明实际列、约束、索引与视图存在。

事实：runner 测试的失败例要求保留 `[1]`；`storage-source-version-upgrade.test.js` 的 U3/U4/U5 要求升级旧行，U11 要求失败后保留已提交的 004。这些旧预期与本任务相反，必须显式修正。`identity-membership-schema.test.js` 有当前完整库大写列名正例；连接账号测试的大写正例却只建旧版本 2，必须改成完整当前库正例。三个结构套件还检查用户表全集，因此选择额外 marker 表会扩大无谓改动。

用户约束：尚未正式发布，不开发旧设计或旧数据兼容迁移；已授权设计、draft、TDD、验证及 ready，批次间不重复请求批准，PR 合并仍由人类决定。规划上 #414 是 P1 数据风险闭环，安排在迭代 9（2026-11-02 至 11-08）；当前迭代 8（2026-10-26 至 11-01）优先 #143 人类 Demo 学习检查点。本改动及绿色测试不能替代 #143 或批准 R1，不代写看板 `Status` 或依赖关系。

假设：当前受信迁移 SQL 足以构造 schema，数据 hooks 不定义 DDL；读取到的 SQL 文本在本次调用内固定。实现先验证这两点；若变为假，修订本计划而不是补历史兼容引擎。已有库是否含非规范业务值仍由现有业务完整性检查负责，schema 准入不扫描、归一或修复旧行。

## Design / Spec

### 2026-10-28 P1 评审回接：SQLite 空白词法

评审 `5678410646` 在 `f9f7da1` 发现 F431-1：JavaScript `\s` 会丢弃 SQLite 认为是标识符/类型组成的 Unicode 字符，导致缺列、NOT NULL/主键退化库被认可并写 marker。用户明确仅将 PR #431 交回本实现会话，授权复现、TDD、独立复评、backup ref 与精确 lease 推送、作者回复和验证后 resolve；不得修改 #432/#433、integration worktree、规划 Status/iteration/原生依赖，也不得合并。

修复选择将唯一 tokenizer 的忽略集合限定为 SQLite 的五个 ASCII 空白（SPACE U+0020、TAB U+0009、LF U+000A、FF U+000C、CR U+000D），其它字符保留为 token，必要时保守拒绝；不构造通用 SQL 等价器。SQLite 官方 token requirements H41100 与本机实际 DDL/PRAGMA 行为交叉验证该集合（`https://www.sqlite.org/draft/tokenreq.html`）。VT U+000B 在实际引擎报非法 token，不纳入合法空白正例。

负例覆盖 ECMAScript Unicode 空白集合中 SQLite 不当作空白的字符，包含 U+00A0/U+2028/U+FEFF；每个字符分别形成列名变化、NOT NULL 退化和账本主键退化，两个正式入口独立断言 `schema_shape` 且 schema/全部行/marker 原样。先在旧实现 RED，再最小实现 GREEN；ASCII 五空白与合法引号正例维持接纳。归因变异把新忽略集合恢复为 `\s`，必须被本组新测试杀死，并运行既有六项准入/事务变异。


两份独立调查得到相同主干：从当前清单构造内存参考结构、明确世代、整体初始化事务。提案 A 用单行 generation 表，提案 B 用 SQLite `PRAGMA user_version`；选择 B，常量 `CURRENT_SCHEMA_GENERATION = 1`。SQLite 把 `user_version` 留给应用使用，无须新增业务表或 008；仅推断结构虽更少写入，却没有磁盘上的明确世代。仅检查 marker 会漏掉伪造/损坏结构；手写全部表结构会与 #194 的 003 修订漂移，两者均不选。

官方依据：`https://www.sqlite.org/pragma.html#pragma_user_version` 明确应用拥有该整数；`#pragma_schema_version` 是 SQLite 自己的缓存失效机制，不能用作应用世代。`https://www.sqlite.org/lang_transaction.html` 规定 `BEGIN IMMEDIATE` 立即取得写事务，其他写者等待或报忙；`COMMIT` 失败仍须尝试回滚且保留原始错误。`pragma.html#pragma_foreign_keys` 说明事务内切换外键无效，连接设置保持原位置。`https://www.sqlite.org/schematab.html` 说明 `sqlite_schema.sql` 是有限规范化并受 `ALTER TABLE` 改写的创建语句，内部自动索引 SQL 为 NULL。本次在线读取了上述原文，并在当前 Node 内存库验证 CREATE 与 `user_version` 在同一回滚中均恢复为空/0。

`migrate` 是唯一打开期准入 owner。先校验清单，读取 SQL 一次，在独立内存连接依序执行这些 SQL，读取 `sqlite_schema` 的用户 table/index/view/trigger 描述，再关闭参考连接；不调用 `migrate` 本身、不运行数据 hooks。忽略 SQLite 内部对象时使用字面 `sqlite_` 前缀，例如 `NOT GLOB 'sqlite_*'`，不能用下划线是通配符的 `NOT LIKE 'sqlite_%'`。对目标库不执行来自其 catalog 的 SQL。

参考形状与实际形状比较对象集合、对象类别/所属表及 SQL。仅用一个小型词法规范化函数忽略注释、空白及 ASCII 标识符大小写；引用只对从参考 catalog 对象名与 `pragma_table_info` 列名取得的当前已知标识符消除，其他带引号 token 保留类别，不能把类型文本里的 `"PRIMARY" "KEY"` 或 `"NOT" "NULL"` 当约束。保留单引号字符串原文、运算符及词边界，防止删空白拼接碰撞。它只覆盖本包 SQL 与 SQLite 对它的 ALTER 输出，不解析语法树，不证明任意等价 SQL，不建立历史注册表。大写列名正例必须通过；CHECK 字符串 `'pending'` 改为 `'PENDING'`、删除 CHECK、改变 PK/索引条件必须拒绝。未知形式宁可明确拒绝；不得把整段 SQL 小写后放行。

目标连接执行一次 `BEGIN IMMEDIATE` 后，才读取世代、用户对象及版本账本，锁外读取不得决定初始化。世代只接纳 0 或当前常量；空对象但未知非零世代也拒绝。真正空库在同一事务内执行全部当前 SQL、现存空库 hooks、各条版本记账、最终结构/账本检查及 marker 写入，最后 COMMIT。任何阶段失败均 ROLLBACK，用户对象和 marker 恢复初始状态。预检 hooks 只在确认空库后调用；非空库绝不执行旧迁移体或 hooks。

非空库先比对对象及账本自身结构，再安全读取并要求版本严格等于 `MIGRATIONS.map(entry => entry.version)`，不接受前缀、缺口、未来版本。读取版本先用 SQLite `CAST(version AS TEXT)` 保留整数十进制值，再逐项与当前整数版本的文本比较，避免合法 SQLite int64 在 Node number 解码时越界而失去结构化拒绝；I/O/BUSY 等原始错误继续传播。完整当前形状且 marker=0 的实际 1–7 库，事务内只写 `user_version`；这是同一当前基线的元数据认可，不是历史升级。marker=当前时仍检查完整形状与账本，并返回 `{ applied: [], version: currentLast }`，不写任何行或 marker。新空库返回完整实际版本清单，不提前实现 #417 的单版本 `[1]`。

拒绝导出 `IncompatibleDatabaseError`，字段固定为 `code='incompatible_database'`、`reason='generation'|'version_list'|'schema_shape'|'unknown_objects'`、`expectedGeneration`、`actualGeneration`、`action='back_up_and_rebuild'`。message 指示停止打开进程、先备份并核对所需数据、由用户在新位置重建；不建议运行旧 repair，不自动删库或备份，不含路径/数据样本。畸形账本也返回此错误；I/O、BUSY、清单/资源错误保留原始错误，不能全部包装为“不兼容”。工厂把 `migrate` 提到旧结构预检前，保留策略在 IO 前快照与失败关句柄；构造函数、运行时业务守卫及事务队列维持现有职责。

`MigrateOptions.entries` 若保留，版本和文件必须与包内完整当前清单一致，不允许 prefix/任意成功清单成为绕过闸门的方法；不符是调用配置错误，早于目标写入。`dir` 继续支持受信打包迁移目录，参考和初始化使用同一批读取的 SQL。故障注入改用数据库包装器，不增加 `skipAdmission`、旧世代白名单或兼容开关。

## Global Constraints

P1 回接新增的持久写入仅为本计划、`tests/integration/storage-baseline-admission.test.js`、`packages/storage/sqlite/src/migrate.ts` 与评审方已创建的 `docs/review/pr-431-mmp-review.md`；后者保留原始 REQUEST_CHANGES 事实，只追加修复/复评证据。不覆盖正在写入的评审内容，更新前磁盘回读。运行态日志/变异保存在本工作树 `.superpowers/`，不修改其它 worktree。

本批唯一源码/测试 owner 是 #414 实现者。允许文件集仅为 `packages/storage/sqlite/src/migrate.ts`（主实现）、`packages/storage/sqlite/src/storage.ts`（工厂顺序/注释），新 `tests/integration/storage-baseline-admission.test.js`，以及必要修正 `tests/integration/migration-runner.test.js`、`tests/integration/storage-source-version-upgrade.test.js`、`tests/integration/identity-membership-schema.test.js`、`tests/integration/storage-connector-account.test.js`、`tests/integration/harness-plugin-host-planning-mapping.test.js`、`tests/integration/storage-sync-surface.test.js`。持续文档为本计划、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 的 Batch 5 局部订正；执行收尾时更新 `docs/README.md`，新增实际债务才登记 `docs/exec-plan/tech-debt-tracker.md`。本次计划审阅不编辑后二者或产品代码。

#194 独占 `003_control_facts.sql`、`storage-rows.ts`、`storage-execution.ts` 及请求指纹契约；本批不触碰它们。参考 schema 自动随当时清单中的 003 变化，同版号但缺指纹列的旧形状被拒绝；合流后重跑测试，不硬编码 #194 列表/hash、不新增跨任务依赖。#415 拥有 repair API、旧 carrier 代码/导出退休，#416 拥有消费者裁定，#417 拥有物理迁移折叠；本批均不代办。保留现有 repair 与运行时断言至其 owner 处置。

不新增依赖、不改 Provider/Host/公共 Storage 端口/Planning 事实源，不自动修复或删除用户库。源码加测试按 additions+deletions 合计：实现与工厂预留 260、新套件约 190、runner 事务/真实并发调整约 120、旧升级及错误断言调整约 150，目标约 720，最多 780，为评审留余量；文档低于 1300。估算不是验收证据：每批实际重算，若逼近 800，先去除重复历史场景、收敛 runner 代码；保留有判别力断言，不靠拆碎文件或删安全测试压数。

## Plan of Work

### Batch 4 · F431-1 复现、修复和回传

在 `fix/storage-baseline-admission` 工作树根运行新 Unicode 矩阵，先记录旧实现缺少预期拒绝的 RED；修复单一 tokenizer 后执行完整 admission/Storage 契约、迁移/repair/Host 回归与 `pnpm verify`。运行 `node scripts/review-mutate.mjs .superpowers/review-431-unicode-fix/mutations.json`，期望旧 Unicode 空白丢弃变异及六项原守卫变异均 KILLED、恢复前后源码字节相同。独立 subagent 以当前产品树复评 P1 与原 AC，未过不得 push/resolve。

保留评审记录，先建当前本地/远端 backup ref 后整理为可独立审阅的修复提交；`main` 推进时只在 #431 工作树对当前 base 做适用验证，不更改另外两条 PR 或 integration worktree。最终 push 用精确旧 head lease；回读 head/base/checks/完整 threads 与 #414 关联后，以作者账号在 F431-1 原 thread 回复、验证成立才 resolve，不 dismiss REQUEST_CHANGES。回滚为恢复备份 ref/整体 revert，任何测试仅操作临时库。

### Batch 1 · 固定拒绝合同与 draft

最小闭环是先以本计划的独立提交创建关联 `Closes #414` 的 draft PR，回读 head/base/draft/closingIssuesReferences，确认 base=main、head=本任务分支、draft=true、关联 issue=414；此时尚无产品或测试实现。可用 `gh pr create --draft -R SingularityKChen/harness-projects --base main --head fix/storage-baseline-admission --body-file .superpowers/storage-baseline-admission-pr.md`，标题按本仓规则填写，正文文件写闭环、计划及 Batch、Closes、当前仅文档验证、风险和回滚。文档提交前执行发布扫描；不提前 ready。

完成上述回读再写新准入测试。主文件为新测试及本计划。以真实当前 SQL/手工版本记账构造有数据当前库和历史库，不能调用旧前缀 `migrate` 来准备 fixture。快照包含全部用户 schema、每张表全部行（安全引用表名）、账本时间戳和 `user_version`。至少覆盖旧 `[1]`/`[1,2]`/`[1,2,3,4]`、错误 generation、未知含数据表（包括 `sqliteX_extra`）、畸形账本、完整版本但缺列或 CHECK/PK 变化；直接入口与工厂各有拒绝负例。

运行 `pnpm test:file tests/integration/storage-baseline-admission.test.js`，期望旧实现因“未拒绝/错误类型/快照变化”变红，而非 fixture 或导入错误。保存具体失败名及基线 head。回滚点为本批提交，撤回只影响分支测试和文档；不合并 PR。

### Batch 2 · 当前基线准入与原子初始化

最小闭环是两个正式入口都遵守上述状态机。主文件为 `migrate.ts`、工厂和新测试；以整次写事务替代逐条提交 helper，不在旧 runner 外再套第二个框架。补完整 1–7、marker0 现有有数据库首次认可、marker1 重开无改动、大写列名、字面值反例、资源错误与失败关句柄测试。空库在后期 DDL、版本写后、marker 写后及 COMMIT 前注入失败，均证实回到无用户对象/marker0，撤掉注入后可重试成功。

用 Worker/child IPC 屏障同时放行两个独立同步 SQLite 连接初始化同一空文件；不使用 sleep 猜时序或同线程 Proxy 递归等待写锁。期望一方 applied=完整当前链、另一方=[]，两方最终世代/版本一致，无重复初始化；接着 `foreign_key_check` 零行、`integrity_check='ok'`。主测试可复用 runner 并发例，避免重复另一套 harness。

运行 `pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/contract/storage-contract.test.js`，期望全部 pass，业务事务失败/嵌套/重启安全断言继续成立。记录实际行数；回滚点为本批提交，测试只用临时库，不触碰用户库。

### Batch 3 · 消除旧预期冲突并交付

最小闭环是全仓回归与当前 PR head 可审阅。旧 source-version fixture 改为裸 SQL+记账；U1/U2/U10 改断言结构化拒绝且全部 schema/行/世代不变，保留句柄释放；U3/U4 的自动归一改为“即便可归一也拒绝”，可合并重复场景；U5 保留当前库幂等，旧 prefix 不再获升级；U11 的分段提交预期替换为整次回滚证据，不继续宣称先前版本可提交。U6 直接 hook 的无副作用回滚断言保留至 #415；U8 当前库运行时坏载体拒绝原样保留。U9 使用完整当前结构的 fixture，继续验证显式 repair 的备份拒覆盖、备份完整性、仅目标列变化、幂等与业务写入，不再依赖 repair 后旧库自动升级。

主测试其余旧错误文案改为统一结构化错误，保留原有零写入、关闭句柄及业务往返断言；连接账号大写正例从完整当前库 ALTER 列名准备，不能继续许可不完整旧 002。不修改当前表全集预期，因为 marker 不增加表。

运行本计划下一节的完整命令组，期望零失败；独立验收审读不变量、错误归类、事务、所有权、体量及公开面。最后整理同批 debug/fixup 提交，提交用 `fix(storage): <中文摘要>` 并带 `Closes #414`，建立已发布 head 的恢复 ref 后才做必要的精确 lease 改写。最终 push 后回读远端当前 head/base/checks/issue 关联及全部 review threads；当前 head 检查通过才 `gh pr ready <PR号>`，并请求人类评审。PR号以实际创建返回值替换，命令带 `-R SingularityKChen/harness-projects`。回滚本 PR 恢复原打开行为，不能删除或改写用户数据库。

## Concrete Steps

实现按 `Plan of Work` 三批顺序执行，验证命令见下一节。每批前运行 `git status --short --branch`、`git rev-parse HEAD`；证据记明检出分支与当次 head。只读开始检查已确认工作树隔离、`.worktrees/` 被忽略及无已有修改；执行者仍需回读，保留其他 owner 的工作。

## Validation and Acceptance

| 验收 | 可判定证据 |
|---|---|
| 当前链继续打开 | 手工实际 1–7+数据、marker0 被接纳，只 stamp marker；重开两次完整快照不变；大写列名可往返 |
| 历史/损坏/未知对象拒绝 | 旧 prefix、gap/future、畸形账本、unknown 含数据对象、同版本错误列/PK/CHECK/索引、未知 generation；structured action 且全部 schema/行/账本/marker 不变 |
| 空库原子、幂等、并发 | 后期故障整次回滚及重试；屏障驱动双进程一方全链一方空；重启/重开/完整性检查通过 |
| 既有安全合同不削弱 | Storage contract、旧拒绝无改动/句柄释放、运行时 carrier 与显式 repair 原断言、打包迁移资源重开通过 |

在已声明的分支工作树根运行以下命令；各组均期望退出 0、测试 `fail 0`。第一组是 issue 要求，第二组覆盖全部行为/错误预期影响，第三组扩大持久化与并发回归：

    pnpm test:file tests/integration/storage-baseline-admission.test.js tests/contract/storage-contract.test.js
    pnpm test:file tests/integration/migration-runner.test.js tests/integration/storage-source-version-upgrade.test.js tests/integration/identity-membership-schema.test.js tests/integration/storage-connector-account.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/storage-restart.test.js tests/integration/harness-plugin-migrations.test.js
    pnpm verify
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

机械 size 之外用 `git diff --numstat origin/main...HEAD` 累加源码和测试 additions+deletions，期望小于 800；文档单算小于 1300。人工检查凭据、本机身份/路径、账号信息、内部系统和保密字样。文档命令/链接检查由 `pnpm verify` 中相应契约测试覆盖。最终 `gh pr view <PR号> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,mergeStateStatus,closingIssuesReferences` 与 `gh pr checks <PR号> -R SingularityKChen/harness-projects` 记录实际输出，review threads 用 GraphQL 分页读完；不能用本地测试代替 hosted checks 或把未完成检查写成通过。

## Progress

- [x] (2026-10-28 14:00 SGT) 回读 #431 唯一 P1、完整线程、工作树与新评审文件，复核三种字符实际列/约束差异。
- [x] (2026-10-28 14:08 SGT) Batch 4：114 项 Unicode 两入口负例在原产品代码上 RED，五 ASCII 空白/引号正例通过；最小修复后 admission+Storage 契约295/295，完整 verify2303+7、边界9/9及 workflow 均通过；七项归因变异全部 KILLED，源码还原字节确认。
- [x] (2026-10-28) 独立复评通过：299项专项、79项受影响回归、228个 marker0/1 Unicode 负探针和10个 ASCII 业务往返；原三项验收未削弱。依复评证据加强 PK 夹具：SAVEPOINT 内证明重复可写后回滚，准入时保持精确1–7账本；恢复旧 tokenizer 的二次 RED 为114项全部 Missing expected exception，GREEN299/299。
- [x] (2026-10-28) 专属分支无冲突 rebase 到 main@b7bd5dea1d2c1180b686f2621ec0f8ae986897e0，range-diff 两条补丁均一致；在06db5ca产品树运行完整verify2345主测试+7MVP、boundary9/9、workflow8文件均通过。
- [x] (2026-10-28) 新main最终独立复评通过，无P0–P3：299项专项、156项组合测试、228个负探针与10个业务正例通过；正式PK夹具及两个补丁range-diff复核通过。
- [x] (2026-10-28) 当前main七项归因变异全部KILLED，含U1恢复旧Unicode丢弃；基线/还原后基线通过，源码/测试hash和冻结产品一致。本地修复、独立验收与提交整理完成；外部交付按下一段实时回读。

外部交付门：在已声明的分支运行 `gh pr view 431 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,reviewDecision,closingIssuesReferences` 与 `gh pr checks 431 -R SingularityKChen/harness-projects`，期望远端head等于最终本地提交、base为main、当前必需检查通过、关联#414。以作者在原线程回复本次head和实际验证后才resolve；原REQUEST_CHANGES及人类复审仍保留。该门的最终结果由PR正文、原线程和交付回传记录，不把易失head/检查复制为本计划固定事实。

- [x] (2026-10-28 评审修正) 在本地 `52957ee` 追加五个反例并观察 27 项中 5 项按预期失败：带引号的 PK/NOT NULL 被放行，int64 极值版本返回 RangeError；修正为参考派生已知标识符集合与版本精确文本比较，合法引号标识符、大写列名、Unicode 与 CHECK 字面量窄测 47 项通过。`pnpm verify` 实际退出 0：typecheck、2184 项主测试与 7 项 MVP 均为零失败/零跳过，计划事实检查 3 项与 workflow-check 通过；独立复核与远端交付门仍由协调者回读，计划保持 Active。

- [x] (2026-10-28 09:14 SGT) 读取两份独立方案、根规范、真实 SQL/入口及冲突测试；选择最小当前准入边界。
- [x] (2026-10-28 09:14 SGT) 在线核对 SQLite 一手文档，内存实验验证 marker/DDL 回滚；本项不是实现验收。
- [x] (2026-10-28 09:17 SGT) saved-file lint 通过，独立第二遍语义复审完成；按根验收者反馈将计划-only draft 前置于任何产品/测试实现。
- [x] (2026-10-28 09:23 SGT) 计划先行 draft PR #431 已创建；双向 closing 关联、base/head/draft、标签、assignee、milestone 与 Project ExecPlan/Batch 回读通过。
- [x] (2026-10-28) Batch 1：在本分支计划提交 `ee53852` 上先跑新准入套件，19 项中 18 项按预期失败（缺拒绝/错误类型、缺 marker、后期失败保留早期提交）；完整日志位于本工作树运行态目录。首轮规模复估源码与测试 A+D 为 537。
- [x] (2026-10-28) Batch 2：实现完整当前链与结构准入、原生世代、整次写事务；晚期 DDL、账本、marker 和 COMMIT 四处故障回滚及重试通过，两个 Worker 屏障驱动独立 SQLite 连接只初始化一次。
- [x] (2026-10-28) Batch 3 本地实现：旧预期按本计划修正，U6/U8/U9 的 hook 回滚、运行时拒绝和显式 repair 安全断言保留；本分支 `pnpm verify` 退出 0（typecheck、2177 项与 7 项 MVP），boundary 9 项及 workflow-check 通过。全仓验证之后仅追加资源/写锁原错误与失败关句柄回归、修正 Worker 名称及夹具注释；最终窄测 `pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/contract/storage-contract.test.js` 实际 174 项通过，最终提交和检查证据见后续回读。
- [x] (2026-10-28 10:04 SGT) 本地独立验收、交付准备及归档已完成；远端检查与 ready 仅按本计划命令实时判定。

## Surprises & Discoveries

2026-10-28 执行环境：宿主默认 pnpm11 的自动依赖检查因无TTY中止，未运行产品测试，不计为RED；随后用 `pnpm --config.verify-deps-before-run=false --config.manage-package-manager-versions=true verify` 选用仓库锁定的pnpm10，完整通过（2345+7）。依赖解析检查仍执行；未改变依赖清单或锁文件。

2026-10-28 14:08 SGT F431-1 归因：首轮旧基线测试147项中114项失败、33项通过，其中76项缺少预期异常、38项因 PK 夹具保留重复版本而得到 version_list、与预期 schema_shape 不符；夹具先经 PRAGMA 证明列名改变或 NOT NULL/PK 退化，并在数据库保存实际行，因此 RED 来自准入而非无效 DDL。新 tokenizer 保留19种 Unicode 字符后，两入口分别返回 schema_shape，完整快照不变。恢复旧 `[^\s]` 的 U1 变异被 Unicode U+A0 column migrate 指定用例杀死；G1/V1/S1/R1/L1/N1 六个既有准入/事务守卫变异均 KILLED。运行 `node scripts/review-mutate.mjs .superpowers/review-431-unicode-fix/mutations.json`，期望并实得 exit0、基线/还原后基线通过，restore 字节一致。

2026-10-28 独立评审：原词法去引号把类型文本里的 `"PRIMARY" "KEY"` 与真正主键约束混同，也把 `"NOT" "NULL"` 混同非空约束；裸 SQL 完整链夹具的 PRAGMA 确认实际 pk/notnull 为 0，故不是语法等价。账本极值虽是合法 SQLite INTEGER，Node 默认 number 解码会先抛 RangeError。五个新测试在修正前真实变红。

2026-10-28 实施观察：初次广测因词法引号字符的索引访问触发 TypeScript `TS2532`/`TS2769`，改用 `charAt` 后 typecheck 与全仓验证通过。独立 adversarial 提醒触发 Unicode 标识符反例，先红后绿。COMMIT 故障在旧实现已能回滚第一条迁移，因此该用例保留为回归证据，不冒充新 RED；本批新的全链回滚证据来自晚期 DDL、最后账本写及 marker 写故障。

2026-10-28 09:14 SGT：现有原子性只覆盖单条迁移，runner 明确期望第二条失败留下 `[1]`；采用全库初始化原子性必须改该断言。旧 U9 的 repair 安全验证可以保留，但其 fixture 必须成为完整当前库，否则“修复后自动升级”会暗中恢复兼容路径。用户表过滤若沿用 `NOT LIKE 'sqlite_%'` 会把合法用户表 `sqliteX_extra` 漏掉，准入必须按字面前缀排除内部对象。Node v26.12.1 的 `BEGIN IMMEDIATE; CREATE TABLE probe...; PRAGMA user_version=1; ROLLBACK` 实测返回 marker0 和空对象集。

## Decision Log

- 2026-10-28：原实现 owner 在 `552cae24` 完成 P1 修复与回传，评审会话按本次人类对 #431–#433 的直接授权接回最终单闭环提交整理、当前 head 复评与 rebase merge。最终产品/测试 blob 与已独立验收树保持相同；规划 Status/依赖与 #415–#417 仍保持原范围。主评审实际新增36个无损拒绝探针和10个ASCII业务往返，均通过，见本 PR 评审记录。

- Decision：按本轮用户明确授权仅接回 #431，保留评审方新文件与原 REQUEST_CHANGES 记录；不碰其它分支/组合树、不合并。Rationale：F431-1 归 #414 原准入验收；不新建重复 issue，不代闭 #415/#417。Date/Author：2026-10-28 14:00 SGT / 用户授权、实现 owner 记录。
- Decision：仅忽略 SQLite 明确的五个 ASCII 空白，其余保留，不增加兼容/SQL parser。Rationale：实际缺列/约束退化来自唯一分词丢字符；变更边界小且可由两入口负例判定。Date/Author：2026-10-28 14:00 SGT / 实现 owner。

- Decision：只对当前参考结构确知的对象与列名字消除引用；未知引用保留 token 类别。Rationale：保留合法当前大写/引用标识符，同时不再推断引号约束词是 SQL 关键字；名字来自同一参考连接，不写关键词注册表、不引入通用解析器。版本账本用精确十进制文本读取避免 number 解码越界，不捕获或包装无关资源异常。Date/Author：2026-10-28 / #414 评审修正实现者。

- Decision：标识符仅折叠 ASCII 大写字母，单引号字面量逐字保留。Rationale：Unicode `K` 与 `K` 是 SQLite 不同标识符；新增反例先观察到 Missing expected exception，再修正并绿测，不能用 Unicode 小写放行不同 schema。Date/Author：2026-10-28 / #414 实现者。

- Decision：授权的 GitHub 元数据写入已确认。Rationale：actor `SingularityKChen`，目标同仓 PR #431 / issue #414 与 Project #10；幂等关联键 `delivery-20261028-414`，回读 PR closingIssuesReferences 与 issue closedByPullRequestsReferences 均指向对方；Status 仍为原值。Date/Author：2026-10-28 09:23 SGT / 交付协调者。

- Decision：选原生 `user_version=1` 加当前清单派生结构，准入只在 `migrate`。
  Rationale：避免额外业务表和双份 schema；与 #194 原位修订自动一致，marker 不能代替实际结构。
  Date/Author：2026-10-28 09:14 SGT / 独立计划审阅者。
- Decision：匹配完整当前链的 marker0 只认可元数据；其他非空库无条件拒绝，不调用旧 hooks。
  Rationale：满足已有当前链继续打开，同时遵守用户尚未发布、不做旧设计/旧数据迁移的明确约束。
  Date/Author：2026-10-28 09:14 SGT / 独立计划审阅者，依据本轮用户授权。
- Decision：整次初始化一把写锁、一次提交；冲突旧测试就地重写真实承诺。
  Rationale：前序成功版本不得在后期失败后残留；真实进程并发取代实现细节 Proxy。
  Date/Author：2026-10-28 09:14 SGT / 独立计划审阅者。

## Idempotence and Recovery

拒绝只读并回滚，保证逻辑 schema、行及 `user_version` 不变，不承诺数据库文件物理字节完全一致。新库失败可移除注入直接重试；marker0 认可事务失败也恢复 marker0。打开失败关闭句柄，回滚失败不覆盖原错误。重复当前打开无变化。所有自动化试验使用临时目录，保留用户原库与已有工作树。

撤回本 PR 恢复旧程序行为，但旧二进制会忽略 `user_version`，本任务不提供 downgrade 协议；不能宣称反向保护。用户恢复是停止进程、备份/导出后核对、在新位置显式重建；没有自动删除、自动 repair、补旧版本或恢复 SQL。shared history 改写必须先恢复锚点并依 `git-expert-operations`，不清理其他 owner 工作树。

## Interfaces and Dependencies

仅用现有 Node `node:sqlite`、`WorkspaceDatabase` 的 exec/prepare/close 及包内迁移资源；不需生产凭据。实现保持 `MigrateResult.applied/version` 与工厂签名，新增错误由 `index.ts` 已有 star export 暴露，不为导出改文件。generation 常量与拒绝字段定义在准入 owner，schema 参考连接必须 finally close。Worker/child 沿用当前 Node 的直接 TS/包解析环境，屏障须有有界失败退出，避免挂死测试。

交付外部写入仅为授权的 issue/PR 机械关联与工程 ready；记录 actor、目标仓库/PR、结果，不改 Planning `Status`/blocked-by。如检查不可用如实阻塞 ready，不另造成功证据。

## Outcomes & Retrospective

2026-10-28 F431-1 最终本地验收：新main@b7bd5dea上的2345+7完整验证、boundary9/9、workflow、24项文档契约及独立299专项/156组合/228负探针/10正例通过；P0–P3无新发现，#414三项AC未削弱。七项变异在该组合上再次全部KILLED，源字节还原确认。阶段性的两条提交曾保留原实现与P1修复边界（Superseded by Decision Log 的最终单闭环提交整理，2026-10-28）；额外兼容、通用SQL解析或重构没有验收依据，未引入。

2026-10-28 14:08 SGT F431-1 本地修复结果（后续交付门描述 Superseded by 本节最终本地验收，2026-10-28）：生产差异为 normalized 的五 ASCII 空白集合及说明，测试新增19×3×2负例和5个合法 ASCII/引号正例；全套 `pnpm verify` 为2303主测试+7MVP、边界9/9与 workflow 8文件无发现。当前冻结产品以本次分支差异与运行态 hash 对照，独立复评已通过（299专项、79回归、228负探针、10业务往返）；其后PK夹具加强的299项GREEN通过，新main验证及远端当前 head ack 仍是下一门；不把旧 f9f7da1 的绿色记录当作本次修复结果。


2026-10-28 14:00 SGT 重新打开 F431-1：下面“无待修/验收通过”的历史结论仅适用于旧覆盖，Superseded by Design / Spec 的 P1 回接与本次复评（2026-10-28）。当时修复尚未完成，不沿用旧绿色证明该反例不存在；该阶段状态 Superseded by 本节最终本地验收（2026-10-28）。


2026-10-28 10:04 SGT 实施验收结果：当前基线准入、完整初始化事务及结构化拒绝已交付；独立验收锁定实现 `9a05b6a` / tree `91a3a4e`，规定命令176/176、受影响回归83/83、独立约束/资源探针10/10、边界9/9和类型检查通过。实现完整验证为2184主测试加7个MVP；没有跳过或取消。最初 SQL 引号归一化与 int64 版本读取两项评审缺陷均先取得5个RED再修复，最终复验无待修意见。旧逐步事务 runner 已收敛为单一准入 owner，无需额外重构。最终发布以本分支当前 `gh pr view 431 -R SingularityKChen/harness-projects` / checks / review threads 回读为准；本节不声称已合并或规划接受。

以下设计阶段回顾保留，Superseded by 本节实施验收结果（2026-10-28）。


2026-10-28 09:14 SGT：完成计划与源码证据收敛，尚未实现、未宣称实现测试通过。Superseded by 下段本地实现结果（2026-10-28）。repair 退休与物理折叠已分别交给 #415/#417，不作为本批新增技术债；若实现产生新的持久化/维护折中，附原因、影响、退出条件登记 `docs/exec-plan/tech-debt-tracker.md`，不能在此隐藏。全验收后更新本节、移到 completed 并更新索引。

2026-10-28 本地实现结果：两正式入口拒绝历史/错误结构并保留原库，真实当前链仅认可原生世代，空库整次原子建成；本地完整验证通过，未新增兼容模式、依赖或债务。执行日志保留在 `.superpowers/sdd/2026-10-28-storage-baseline-admission/`；该路径仅表达执行上下文，日志不进文档。本地收尾之后仍须由协调者独立验收与读取最终远端检查，不能据此关闭 #414 或批准 R1。

## Artifacts and Notes

最小原生回滚探针观察为 `{"node":"v26.12.1","marker":{"user_version":0},"objects":[]}`。这是方案可行性证据；实现的原子性还必须通过目标入口故障注入，不能以此替代。

## Bottom Change Note

Change Note (2026-10-28 09:14 SGT)：合并两份独立提案并按实际源码修正：原生 marker、全链/全结构准入、整体事务、旧测试冲突、字面内部前缀过滤与 #194/#415/#417 所有权。

Change Note (2026-10-28 09:17 SGT)：保存后重读并完成语义复审，结构 lint 通过；依据根验收者指出的 draft 时序问题，明确先提交计划并创建/回读 draft，再开始红测试，保留同一闭环与所有权。

Change Note (2026-10-28 09:23 SGT)：记录计划先行 draft 与机械元数据的实际 ack，允许实现者开始 RED；未宣称产品代码完成。

Change Note (2026-10-28 实施收尾)：记录真实 RED、ASCII 修正、整体事务与 Worker 并发、旧预期修正和本地完整验证；Active 与 ready 门保留给协调者。

Change Note (2026-10-28 独立评审修正)：记录两个缺陷的五项真实 RED、当前引用名字派生规则与 int64 版本结构化拒绝；维持当前基线范围和原始资源错误语义。

Change Note (2026-10-28 10:04 SGT)：独立验收通过后归档，记录两项修复、回归、组合验证与当前 PR 回读门；更新索引和父计划局部方案，未改规划 Status。

Change Note (2026-10-28 14:00 SGT)：按用户回接指令记录 F431-1、独占边界、词法根因、TDD/变异/独立复评与回传门；保留历史事实但撤销旧覆盖的完成推断。

Change Note (2026-10-28 14:08 SGT)：记录114项RED、295契约GREEN、2303+7完整验证与七项归因变异/字节还原；独立复评和远端门仍未代报。

Change Note (2026-10-28)：准确订正首轮RED归因，记录独立复评与精确账本PK夹具的二次114项RED/299项GREEN；远端门仍按实际回读。

Change Note (2026-10-28)：记录双backup、仅本分支rebase与新main完整验证，公开环境差异不混同产品RED。

Change Note (2026-10-28)：补新main最终独立风险矩阵复评，原三项AC未削弱；产品冻结未变。

Change Note (2026-10-28)：记录最终base七项归因变异/产品还原与完整验收，完成本地修复生命周期；远端交付仍以当前PR/线程实时回读为准。

- 2026-10-28：记录实现修复回传后的评审会话收尾、单一交付提交与产品树身份门；保留原独立测试、变异及阶段证据。
