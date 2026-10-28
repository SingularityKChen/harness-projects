# PR #431 MMP 交付评审

> 状态：修复及独立复评完成，最终交付按当前 head 回读；创建：2026-10-28。保留初审与修复的独立证据。

## Purpose / Big Picture

验证 `fix(storage): 拒绝非当前基线并原子初始化空库` 构成可独立验收、合并和回滚的 MMP 能力闭环。测试通过只是证据之一，必须同时核对产品结果、状态拥有、失败恢复和 issue 验收。

## Context and Orientation

观察于 2026-10-28：PR #431，head `f9f7da1b2401b51e7abbe9737c2c963b678e367c`，base `main@4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`，执行上下文为 `.worktrees/storage-baseline-admission`、分支 `fix/storage-baseline-admission`。关联 issue #414。易失事实重算：`gh pr view 431 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,mergeStateStatus,statusCheckRollup,closingIssuesReferences`，并完整读取 review threads。

## Design / Spec

先建立以下风险矩阵，再检查 diff、上下文、正常/失败路径、反例和验收。使用 Superpowers、Qian Systems Router、First Principles Development；子评审 gpt-6.1-sol 高推理，主评审综合裁决。替代方案为只读 diff 或只采信绿 CI，因无法证明产品闭环而不采用。

| 级别 | 风险假设 | 检查层与判定证据 |
|---|---|---|
| P0 | 打开库破坏数据、合并破坏 main、安全或硬约束失守 | 原子性、拒绝前后数据/结构、公开面、依赖和当前门禁 |
| P1 | 权威事实回退、异请求重放、跨代/并发失序、闭环核心失败 | 用户入口到 Host/Storage/Provider 的完整因果路径、反例、恢复、issue 验收 |
| P2 | 非核心错误处理或体验、测试判别力与验收遗漏 | 失败路径、反例、base/head 对照、现有 issue 承接 |
| P3 | 文档、命名与可维护性问题、设计复杂度不相称 | 设计取舍、重复实现、证据可复现与范围 |

### 独立专项矩阵结论（2026-10-28，锁定上述 head/base）

| 层 | 覆盖与结论 |
|---|---|
| 代码 / P0 | 整次 `BEGIN IMMEDIATE`、DDL/账本/marker/COMMIT 故障回滚、重试及未知对象无损拒绝均有通过证据；未发现 P0。 |
| 产品闭环 / P1 | 两入口仍会认可 Unicode 空白造成的缺列/约束退化库并写入当前世代；首次 `putWorkspace` 失败，#414 核心验收未闭合，见 F431-1。 |
| 架构 | 准入 owner 集中在 `migrate`；工厂先准入再构造，未改变 Planning/工程正交、Provider ack 或凭据句柄边界；依赖边界 9 项通过。 |
| 测试 | 180 项专项/Storage 契约与 66 项受影响回归通过；6 项守卫变异均有指定 `killedBy` 并 KILLED，但 Unicode 空白反例不在现有覆盖中。 |
| 工作项 / P2–P3 | #414 三项验收中结构拒绝仍不满足；#223 保持父项，repair 退役由 #415、消费者裁定由 #416、物理折叠/打包由 #417 承接，未把历史库不升级或这些已排定范围当成本 PR 缺陷。无其他独立 P2/P3 finding。 |
| 设计取舍 | 原生 marker、内存参考形状与一次事务适合当前尚未发布的基线；无需兼容升级框架。修复本问题应收紧 SQLite 空白词法或加实际列/约束交叉校验，无需扩大为任意 SQL 等价证明器。 |

## Global Constraints

2026-10-28 14:05 SGT 实现回接边界：用户仅把 #431 交回原实现 owner，授权修复、独立复评、保留本记录、backup/精确 lease、作者回复并在验证后 resolve；#432/#433 与 integration worktree 由评审会话处理，本实现会话不改。以下原评审写入边界描述评审阶段，不扩展本实现者的合并/规划写入权限。

只写本 PR 的 `docs/review/pr-431-mmp-review.md`；产品代码由后续明确 owner 修复。遵守七条不变量，规划 Status 与依赖关系不随工程事件变更。评审账号 `gh-review`，开发和合并账号 `gh`。证据不写本机绝对路径或敏感信息。

## Plan of Work

### Batch 1 · 独立分层评审

检查代码、产品闭环、架构、测试、反例、issue 验收与重复追踪；锁定全部线程和 checks。命令在上述分支根目录执行：`git diff 4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc...HEAD`、受影响测试、`pnpm run boundaries`。预期为有判别力的证据及每项明确裁决。

### Batch 2 · 统一评审与收尾

主评审一次性提交全部 inline；P0/P1 则 REQUEST_CHANGES 并核实实现 owner，P2/P3 或无问题则 APPROVE 并按本次人类授权修复、独立复评、归档、整理提交与 rebase merge。最终 push 后重新锁定 head/base/checks/threads/issue。回滚：保留恢复 ref，整体撤回本 PR；不删除用户数据。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 完整矩阵和产品闭环 | 初审 F431-1 为 P1；Superseded by 本文修复证据与最终主评审复核（2026-10-28）：根因已修复，独立复评无新增 P0–P3，三项验收保持完整。 |
| 当前 head 与线程、CI | 实现 owner 已在 `552cae24` 回读所有有效 checks 通过并回复/resolve 原 P1 线程；评审方最终整合后须再回读新 head，不沿用该旧检查。 |
| 修复与交付 | 最小 tokenizer 修复、114 个判别负例和合法空白正例已独立验收；评审方接回最终单闭环提交整理、当前 head 复审与授权 rebase merge。 |

## Progress

- [x] 2026-10-28：锁定初始 head/base，建立 P0–P3 风险矩阵。
- [x] 2026-10-28：完成独立专项全矩阵、反例、issue 范围、判别性验证；发现 F431-1（P1），无其他独立 finding。
- [x] 2026-10-28：主评审已一次性提交 REQUEST_CHANGES（review 5678410646），仅1条 P1；原线程 discussion_r4397368341，锁定 f9f7da1。
- [x] 2026-10-28：实现owner完成唯一P1根因修复、TDD和两轮独立复评，当前main组合无新增P0–P3；远端交付必须按当前head回读后回复/resolve，原REQUEST_CHANGES保留给评审会话重审。

## Surprises & Discoveries

### F431-1 · P1：按 SQLite 的空白字符集分词，避免把缺列或约束退化库认可为当前基线

新增行锚点：`packages/storage/sqlite/src/migrate.ts:42`（`normalized` 的 `[^\s]`）；比较入口为同文件 55、63、66 行。JavaScript `\s` 包含 U+00A0、U+2028、U+FEFF，SQLite 会把这些字符当作未引用标识符的一部分，而当前 tokenizer 直接丢弃它们。因此只把 002 中 `name TEXT NOT NULL` 的普通空格换成 U+00A0，实际列名就是 `name<U+00A0>TEXT`、根本没有 `name`；完整 1–7 账本的库仍被 `migrate` 返回 `{ applied: [], version: 7 }` 并写 `user_version=1`，`createSqliteStorage` 也返回成功，随后 `putWorkspace` 报 `table workspace has no column named name`。U+2028/U+FEFF 同样复现。另一组同根反例 `name TEXT<U+00A0>NOT NULL` 使实际 `notnull=0`，`version INTEGER<U+00A0>PRIMARY KEY` 使账本实际 `pk=0`，均仍获准入；前者可成功写入 NULL。

归因边界：在同样的完整夹具上，base `4be26d5` 的旧 runner 也会放行（marker 仍为 0），所以不宣称缺列库过去被拒绝。本 PR 新增的结构准入仍漏掉明确在 #414 范围内的缺列/PK/NOT NULL 差异，而且新增了错误的当前世代认可；这是本次准入闭环的不完整，不是要求升级历史数据。已有 #414/#223 直接承接该验收，无需新开重复 issue。

复现与证据均在上述 immutable head 的分支根运行，运行态文件位于 `.superpowers/review-431-independent/`：`node .superpowers/review-431-independent/formal-probe.mjs`，日志为 `formal-probe.log`；它对三种字符逐一输出实际列、base/head 返回、marker 与真实 Storage 写入错误。独立负测试命令 `node --test .superpowers/review-431-independent/unicode-rejection.test.mjs` 退出 1，6 项全部因 `Missing expected exception` 失败（两入口 × 三种字符），日志 `unicode-rejection.log`；没有因夹具语法/导入错误变红。

建议：只忽略 SQLite 认可的 ASCII 空白（空格、TAB、LF、FF、CR），保留其余字符作为 token；或在 catalog 词法比较之外核对实际列名/类型/约束。补两入口拒绝、marker/schema/全部行不变和可恢复断言，同时保留已有 ASCII 大写/合法引号标识符正例。产品代码未修复；由现有实现 owner 修复后重锁 head 并独立复评。Superseded by Outcomes & Retrospective 的本轮修复证据（2026-10-28），原 finding 保留。

### 实际验证与变异

以下命令均在 `fix/storage-baseline-admission@f9f7da1` 根目录运行；本地结果不替代 hosted CI、产品 Demo 或 R1 发布裁决。

- `pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/contract/storage-contract.test.js`：退出 0，180/180 通过，无失败/跳过。
- `pnpm test:file tests/integration/storage-source-version-upgrade.test.js tests/integration/identity-membership-schema.test.js tests/integration/storage-connector-account.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/storage-sync-surface.test.js tests/integration/storage-restart.test.js tests/integration/harness-plugin-migrations.test.js`：退出 0，66/66 通过，无失败/跳过；含真实打包 SQL 重开和显式 repair 安全合同。
- `pnpm run boundaries`：退出 0，9/9 通过。未改产品文件；变异后 `git diff --exit-code -- packages/storage/sqlite/src/migrate.ts` 退出 0。
- `node scripts/review-mutate.mjs .superpowers/review-431-independent/mutations.json`：最终树整表运行，退出 0，基线与还原后基线通过，6/6 KILLED。spec/log 均保留在该运行态目录，未手工修改产品代码。

| 变异 | 指定 killedBy | 结果 |
|---|---|---|
| G1 绕过 generation | `拒绝 generation` | KILLED |
| V1 绕过完整账本 | `拒绝 gap` | KILLED |
| S1 绕过最终结构比较 | `拒绝 missing-column` | KILLED |
| R1 移除失败回滚 | `空库 late-ddl 故障` | KILLED |
| L1 改用 deferred BEGIN | `双 Worker 屏障` | KILLED |
| N1 折叠字符串字面量大小写 | `拒绝 check-literal` | KILLED |


初始 `f9f7da1` 的可选 `Create review session` 日志由主评审查明为本地 DSH 端点拒绝连接；主分支保护实时回读只要求 `PR Fast Gate`（strict）。修复后的发布必须重新核对各检查，不能沿用初审状态。

## Decision Log

- 2026-10-28：原实现会话完成 `552cae24` 修复回传、远端检查与线程处理后由评审会话接回最终收尾。人类本次对 #431–#433 的授权在无 P0/P1 后覆盖修复、复评、归档、提交整理、issue 核验与 rebase merge；不授权更改规划 Status 或依赖。原实现与最终整理均保留恢复 ref。

- 2026-10-28 14:05 SGT：评审会话按人类要求将唯一有 P1 的 #431 委派回原实现 owner，修复由原实现 owner 完成，最终用当前 immutable head/base、测试/归因变异、issue/check/thread、backup ref 与剩余边界在本会话回传，评审会话通过 wait_threads 读取后再次评审；不主动发跨会话消息，不合并本 PR，不 dismiss 原 REQUEST_CHANGES。

- 2026-10-28：人类在本会话明确要求评审 #431–#433，且“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，包含“修复 → re-review → 归档 ExecPlan → … → merge_method=rebase 合并”。本次授权只覆盖这三个 PR；存在 P0/P1 且有实现会话则交回该会话。

## Idempotence and Recovery

评审前后校验 immutable head；head/base 变化则旧结论失效。未核实的问题不 resolve。已发布历史整理前建立 backup ref，使用精确 lease。禁止自动修改规划 Status 或依赖关系。

## Interfaces and Dependencies

GitHub API/CLI、现有 worktree、pnpm 工具链和评审账号；外部写入记录 actor、目标仓库/PR、head、review 事件和结果。

## Outcomes & Retrospective

### 最终主评审复核（2026-10-28）

固定 `06db5ca` 的根因修复与新增测试再次由初审子评审只读审查，无新增 P0–P3。实现 owner 发布 `552cae24` 后，主评审确认其产品/测试 blob 与该已审树相同，工作区干净；独立执行 36 个 Unicode 无损拒绝探针（U+00A0/U+2028/U+FEFF × 列名/NOT NULL/主键 × marker0/1 × 两入口）及10个合法 ASCII 真实业务往返，全部通过。证据由主评审实际执行，不归入实现 owner 的测试计数。最终整合只改文档和提交组织，产品/测试须与 `552cae24` 相同；当前 head 的 CI/threads/issue/单提交与 rebase merge 收据在 PR 中回读记录。

### 2026-10-28 14:08 SGT · 实现 owner 的修复证据（独立复评通过，远端交付另行回读）

F431-1 已从唯一 normalized 忽略集合修复：只丢弃 SPACE/TAB/LF/FF/CR，其余字符保留参与结构比较，未新增 schema/迁移/兼容路径。正式回归新增19种 Unicode 字符×列名/NOT NULL/账本主键×migrate/factory，共114个两入口独立负例；PRAGMA 先证明实际退化并保存行，拒绝必须结构化 schema_shape、schema/全部行/marker 不变。五个 ASCII 空白与合法引号正例仍接纳。

在 `fix/storage-baseline-admission` 工作树，产品保持 f9f7da1 时运行该新套件：147项中114失败、33通过，其中76项 Missing expected exception、38项为 version_list/schema_shape 原因不符；最小修复后 admission+Storage契约295/295，完整 `pnpm verify`2303主测试+7MVP，边界9/9、workflow 8文件无发现。归因变异命令 `node scripts/review-mutate.mjs .superpowers/review-431-unicode-fix/mutations.json` 共7/7 KILLED：G1/V1/S1/R1/L1/N1保留原指定 killedBy；U1 恢复旧 Unicode 空白丢弃被 Unicode U+A0 column migrate 杀死，基线与还原后基线均通过、源码字节一致。运行态证据不进入公开正文。

2026-10-28 独立复评：在冻结产品树运行299项专项/Storage合同、79项受影响回归，全部通过；另独立执行19字符×3形状×marker0/1×两入口的228个负例及10个ASCII真实业务往返，全部通过，原三项AC未削弱，无新增P0/P1。独立PK探针保持精确1–7账本。依该证据，将正式PK夹具的重复版本演示包在SAVEPOINT中并回滚，避免版本清单拒绝干扰归因；恢复旧tokenizer后二次147项中114项全部因Missing expected exception失败、33通过，恢复修复后299/299通过。

2026-10-28 新main组合：只将本分支rebase到main@b7bd5dea1d2c1180b686f2621ec0f8ae986897e0，两条补丁range-diff均一致；06db5ca产品树的完整verify2345主测试+7MVP、边界9/9、workflow8文件全部通过。组合独立复核和七项归因变异随后完成，见下段。

2026-10-28 最终base独立复评通过：299专项、156组合测试、228负探针、10业务正例；无P0–P3，#414三项AC未削弱，两提交range-diff及冻结产品hash确认。该复评未写仓库或外部系统。

2026-10-28 当前main归因变异复跑完成：G1/V1/S1/R1/L1/N1/U1共7/7 KILLED，基线及还原后基线通过，两个产品文件hash与最终独立验收一致。发布前机械及五类人工检查、提交规模和文档检查必须覆盖最终提交；远端head/checks/issue/thread仅按本记录Context中的命令实时读取。

以上是修复阶段本地证据；原 reviewer REQUEST_CHANGES 保留，后续由评审会话重锁最终 immutable head 复审，不由作者替代其批准。


2026-10-28 14:05 SGT 实现回接进行中（Superseded by 本节修复证据与最终主评审复核，2026-10-28）：原 P1 已独立复现，114 项两入口 Unicode 负例在原产品代码上均 RED；五 ASCII 空白/引号正例 GREEN。最小修正仅收紧 normalized 的忽略集合，正在运行归因变异、必要回归及独立复评；此阶段未宣称已 push 或已 resolve。后续证据追加于本节，原 REQUEST_CHANGES 结论完整保留。


初审独立专项结论为 REQUEST_CHANGES（Superseded by 本节修复证据与最终主评审复核，2026-10-28）：F431-1（P1）阻止 #414 结构准入闭环。其余事务、并发、无损拒绝和边界证据通过；未发现第二个独立问题。下一道门为既有实现 owner 修复、重锁 immutable head、重跑 Unicode 负例与原有正例/变异后独立复评。线程、远端 checks 和统一 review 由主评审记录。

## Bottom Change Note

- 2026-10-28：在逐文件审查前建立矩阵、边界和授权记录。

- 2026-10-28：补独立专项矩阵、F431-1、180+66+9 项实际证据及六项 killedBy 变异；产品代码已还原。

- 2026-10-28 14:05 SGT：按用户回接授权记录原 review/线程与独占范围，追加 TDD 根因/阶段证据；未改原 finding 内容或代替评审会话批准。

- 2026-10-28 14:08 SGT：补 F431-1 的最小修正、双入口矩阵、完整验证与归因变异；保留初评结论，独立复评与远端回传仍单独记录。

- 2026-10-28：记录独立复评、准确RED归因及精确账本PK探针加强；原评审结论/作者权限边界保留。

- 2026-10-28：记录仅本分支rebase后新main完整验证，后续远端当前head门独立回读。

- 2026-10-28：补新main独立最终复评及原三项AC证据。

- 2026-10-28：补当前main七项变异复跑、字节还原及原线程交付门；作者不替代评审会话批准。

- 2026-10-28：主评审接回最终收尾，追加实际36+10探针与独立代码复审；在旧阻塞/阶段结论原处标Superseded，当前验收与远端门分开记录。
