# SQLite v1 数据模型栈 ExecPlan

> 状态：Completed（2026-09-26：六层随 #121 → #175 以 rebase merge 合入 `main` 后归档，交付状态以 D2 的回读命令为准；v1 是否冻结、#28 / #5 的关闭归属、裁决 R4 / R8 偏离的采纳仍待人类伙伴决定）
> 创建：2026-09-23
> 范围：把 Gate E1 裁决的 revise 清单（R1–R8）落成 SQLite 的表与约束，并用一个真实的 `Storage` 实现验证这套模型可用。本轮推进冻结条件；不做真实 provider 切片。
> 上游输入：`docs/architecture/gate-e1-ruling.md`（PR #108）、`docs/architecture/release-gates.md` §2、`docs/project-management/merge-queue.md` §4、`docs/development/workflow.md`、`tests/integration/README.md`；issue #4 #5 #27 #28 #119 #120

## Purpose / Big Picture

完成后，一个没有本次对话历史的人可以做到三件事：

1. 从空目录运行迁移，建出本地数据模型 v1，并在每条表与约束上读到它追溯到 Gate E1 裁决的哪一条 revise 项；
2. 对着同一个库跑 `node --test tests/contract tests/integration`，看到身份、成员关系、观察定序、写入幂等与重启恢复这些不变量被断言——同一套 storage 契约用例同时跑在内存替身与 SQLite 实现上；
3. 读到一份明确的清单：R1 的 12 条条件里，本轮覆盖了哪几条、剩下的由谁覆盖。

最小成功证据（三条，缺一条本轮不算完成）：

| # | 证据 | 判定命令 |
|---|---|---|
| 1 | 空库建出全部表、二次运行是 no-op、每张表都能在"表 → R# / 不变量"映射里找到出处 | `node --test tests/integration` |
| 2 | 同一套 storage 契约用例跑在两个实现上（内存替身与 SQLite），全绿 | `node --test tests/contract` |
| 3 | 六条行为全部有裁决，R1–R8 全部落到表或约束上（行为 6 的证据来自 #119） | 读 `docs/architecture/gate-e1-ruling.md` §2 与 §4 |

**本轮不声称 v1 已具备冻结条件。** 本文件是**跨六层的控制计划**，随 L1 进入 `main`，因此它在每个合并点只能写**那个时点为真**的事实：每层的交付状态是一个**回读命令 + 期望**，不是写在这里的结论（见 D2 与 `Validation and Acceptance`）。冻结是规划决定，由人类伙伴在 R1–R8 落地后作出（`docs/architecture/gate-e1-ruling.md` §9）；未覆盖风险见 `Outcomes & Retrospective`。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 层（layer） | 栈内一个 PR；一层一个 issue、一个可独立验收与回滚的闭环 |
| 栈（stack） | 自下而上合并的一串层；下层是上层的 base |
| 原始层 | 平台观测到的原样事实：成员关系、字段值、观察、游标、写尝试 |
| 投影层 | 归一化后供 core 消费的当前状态：`WorkspaceProjection` 及其修订号 |
| 端口（port） | `packages/capabilities/src/storage.ts` 的 `Storage` 契约；存储实现必须满足它 |
| 判别性用例 | 缺陷存在时必须变红的用例；本计划要求每批至少一条，并配一次注入实验 |
| 注入实验 | 故意破坏被测实现或 DDL，确认用例变红，然后还原并复跑确认变绿 |

### 关键路径与非关键路径

**关键路径（本轮唯一的一条）**：

```text
#108 被采纳（人类）
  → L1 #119 不确定创建的裁决证据（R8 的状态集 + 行为 6）
  → L3 #28 执行/关系/写入表（R4–R8；需要 R8 的状态集与 L2 的外键）
  → L4 #163 → L5 #164 → L6 #120（端口分三层落地，最后闭掉 #5）
  → v1 冻结（人类）
```

**并行支路**：L2（#27 身份与成员表，R1/R2/R3/R7）只依赖 #108，不依赖 #119，因此与 L1 并行开发。它排在 L3 之下是因为 L3 的外键指向它的成员关系表。

### 本轮不做的事

R3 的"读回后才提交投影"与 R6 的"事件缺失时同步必须收敛"是**写路径**语义，落在真实 provider 切片；本轮只把它们的表与"不得存在的东西"落成 DDL 与用例。不改 `packages/core`、`packages/controller`、`packages/ui*`。

不在关键路径上、登记过理由的有两条（原文在本文件的 git 历史里，2026-09-24 评审要求删掉只剩表头的空表）：真实 provider 切片在 v1 具备冻结条件之前开发会把未定的键固化进 provider 代码；真实 provider 切片需要人类伙伴先定安全边界。两条都因此排在本轮之后，判据不变——**本轮不开发真实 provider 切片**。

## Design / Spec

### D1. 本轮的闭环是"v1 具备冻结条件"，不是"表建好了"

`docs/architecture/gate-e1-ruling.md` §3 写明 `revise` 的完成条件是 §4 的 R1–R8 全部落地。因此本轮的验收对象是 **R1–R8 的落地 + 可复跑的证据**，不是 DDL 的行数。R8 的落地还要求行为 6 先有证据，否则它的状态集只能靠猜——所以本轮第一层是证据，不是表。

### D2. 栈底是 #108 的分支，不是 `main`（**Superseded by L1 级联（2026-09-23）**：栈底已是 `main`，实测栈序见下表）

裁决文件 `docs/architecture/gate-e1-ruling.md` 只存在于 PR #108 的分支上。本轮每一层都要引用它的 R1–R8 与 §2 的行为裁决：若以 `main` 为底，这些引用在 base 上不可解析，评审也看不到被引用的原文。代价是 #108 的评审意见会沿栈级联；这个代价在本仓库是已知且被接受的（`docs/project-management/merge-queue.md` §4）。

栈序（自下而上，base 逐层指向下一层）。**head、base 与交付状态一律回读，本表不写 SHA**（`PLANS.md` §4「易失状态写成回读命令 + 期望」；原先写死的 SHA 在每次 rebase / 级联 / 强推后都会变成不可解析的旧值，2026-09-24 评审实测六格全部失效）：

| 层 | 分支 | PR | 内容 | base（该 PR 自己声明的） |
|---|---|---|---|---|
| L0 | `test/e1-ruling`（已合并，分支已删除） | #108 | E1-4 裁决 `revise` 与四条 ADR | `main` |
| L1 | `test/e1-uncertain-create` | #121 | 本计划 + #119 的证据与裁决订正 | `main` |
| L2 | `feature/storage-identity-membership-tables` | #122 | 迁移 002：身份、成员、字段值与投影表 | L1 |
| L3 | `feature/storage-execution-relation-write-tables` | #157 | 迁移 003：执行、关系、观察、游标与写入表 | L2 |
| L4 | `feature/storage-sqlite-port2` | #167 | 端口机制 + 地基面（事务、workspace/binding/entity/身份/投影/repository/revision） | L3 |
| L5 | `feature/storage-sqlite-sync-surface` | #170 | 规划同步面（成员关系/字段值/观察/游标） | L4 |
| L6 | `feature/storage-sqlite-execution-surface` | #175 | 执行与写入面 + 整端口契约全绿 + 文件库重启 | L5 |

**「这一层关闭哪个 issue」不在本表里**：`Closes` 是发布面上的事实断言，唯一权威是 GitHub——

```bash
gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences
```

计划里一律写 `Refs`，并在交付证据的那一层写明理由。2026-09-24 评审实测：本表原先的 Closes 列、各层计划正文与收敛计划的 Batch 标题是**三套互不相同的答案**，而三者都不等于上面的回读结果。

逐层回读命令与期望：

```bash
gh pr list -R SingularityKChen/harness-projects --head <分支> --state all --json number,baseRefName,headRefOid,state
```

期望：每层恰好一行；`state` 为 `OPEN` 或 `MERGED`；`baseRefName` 等于上一层的分支（L1 为 `main`）；`headRefOid` 与上一次回读不同即表示该层有新提交。**「这一层交付了吗」的判据是这个命令加该层自己的验证命令，不是本文件里的任何一句话。**

L0 的内容（裁决与四条 ADR）已在 `main` 上，因此 L1 引用裁决原文在 base 上可解析。L2–L6 的 base 是上一层。`size` 的基线一律取**该层自己声明的 base**，不要拿 `origin/main` 报数——栈内层相对 `origin/main` 量到的是整条栈的累计（`docs/project-management/merge-queue.md` §4.6 记录了由此产生的假超限）。栈链接与自动 retarget 见同一份文档 §4.4–§4.6。

PR 创建、`closingIssuesReferences` 回读与栈链接按 `docs/project-management/merge-queue.md` §4.2 / §4.4 的配方执行；本计划不复述该配方，只记录本轮的层与顺序（同一个事实只写一处）。

### D3. 为什么 #119 在本轮，而不是下一轮

1. R8 明确"补证据前不得冻结该表的状态机取值集合"，而 #28 要建那张表；
2. 行为 6 是 #4 六条里唯一没有证据的一条，#4 是 R1 第 1 条条件的判定对象（**Superseded by L1（#119，2026-09-23）**：该条已不成立——行为 6 的"创建内容那一步响应丢失"分支已补测，**L1 提议判 `pass`，采纳权在人类伙伴**，见裁决 §2.6 与 §9 的待决项）；
3. **Superseded by D10（2026-09-23）**：已合并迁移文件不得修改；该限制在首次 MVP 发布前不适用。

### D4. 为什么 S-2 与 S-3 分两层

两层的闭环不同、可回滚点不同：#27 的闭环是"身份与成员关系在库层面唯一且角色正确"，#28 的闭环是"控制事实在库层面可关联、可定序、可恢复"。#28 的 issue 自己写明它被身份表阻塞（关系需要实体可以指向）。合成一个 PR 会让"哪条不变量被破坏"无法单独定位与回滚，也会顶到 1000 行代码上限。

### D5. 为什么端口实现（L4）必须在本轮

1. **它是对模型可用性的决定性验证。** 表与约束只能证明"非法状态被拒绝"，证明不了"合法操作走得通"——少一列、外键方向错、唯一约束挡住正常写入，都只有在实现端口时才暴露。D10 取消了"迁移不可修改"这条理由，但没有取消这一条：模型要么被一个真实实现走通过，要么只是一张草图。
2. **#5 的重启判据需要一个真实实现。** "重启后身份、关系与执行上下文不变"在内存替身上是模拟的（导出/导入内部状态）；只有落在一个文件上、关掉句柄再打开，才是真的。

### D6. v1 的端口面必须能触达每一张冻结的表（2026-09-23 修订）

**Superseded by 本节（2026-09-23）**：本节原先写"本轮不扩展 `Storage` 端口面，原始层是存储内部事实"。按 D10 的原则重判后改为：**端口面覆盖每一张冻结的表**。理由不是"改动量最小"，而是**哪一层拥有推导**。

原始事实（成员关系、字段值）是平台观测到的原样值；归一化状态（`NormalizedStatus`）由 `packages/domain` 的策略决定。推导只能有一个权威落点，因此它属于 core 而不属于 storage：storage 存原样值，core 读原样值再写投影。若端口触达不到原样值，那些表就没有写者、也没有读者——那不是"最小实现"，是模型不自洽。

由此 v1 端口新增（最小集合，形状直接由 R1/R2/R5 的表推出，不是猜的）：

| 新增 | 形状 | 为什么必须有 |
|---|---|---|
| `MembershipRecord` + `putMembership` / `getMembership` / `listMemberships` | `(workspaceId, projectExternalId, itemExternalId, contentKind, contentExternalId, membershipCreatedAt, membershipUpdatedAt)` | R1 的成员关系是字段值与观察的挂载点；没有写者它就没有意义 |
| `MembershipContentKind`（`packages/domain`） | `issue` / `draft` / `change_request` | 成员关系的内容种类比 `ExternalIdentityKind` 窄；把 `branch` / `worktree` 排除在类型之外，比运行时校验更早失败 |
| `FieldValueRecord` + `putFieldValue` / `listFieldValues` | `(workspaceId, itemExternalId, projectFieldId, value, observedAt)` | R2/R3 的字段值是投影的输入；定位键不含可选值 id |
| `ReconcileCursorRecord` + `getReconcileCursor` / `putReconcileCursor` | `(workspaceId, lastReconciledAt)` | R5 要求游标是"上次全量对账时刻"，不是增量游标 |

**刻意不新增**（防止过度设计）：成员关系的删除、字段值的历史版本、观察的查询接口。它们的消费者还不存在，等真实 provider 切片提出需求时再加。**这不等于"以后才补"**：上面四项每一项都由 R1/R2/R5 指名要求，缺了它们 R1/R2/R5 就没有落地。

端口是公共接口，因此按 `AGENTS.md` §2：新增的记录与语义要有契约测试（L2/L3 各自的套件用例），且两个实现（内存替身与 SQLite）跑同一套断言。

### D7. R4 的定序语义落在现有端口方法上，不新增方法

`Storage.recordObservation` 的现有语义是"重复观察返回 `false` 且不覆盖"。R4 要求"`updated_at` 更小的观察被拒绝、相等时整快照替换"。两者可以落在同一个方法上：入参 `ProviderObservation` 已有 `sourceVersion`（平台 `updatedAt` 的载体，`packages/core/src/chain-facts.ts` 已在按它比对）与 `receivedTime`（本地接收时刻）。因此本轮**不改签名**，而是：

- 把返回值的含义写清楚：`false` = 本次观察未被应用（重复**或**乱序），调用方不得把它读成"已应用"；
- 在 storage 契约套件里加一条判别性用例：先投递新观察，再投递旧观察，断言后者返回 `false` 且已提交状态不变；
- 内存替身与 SQLite 实现都要满足这条用例——这正是"同一套断言跑在两个实现上"的价值。

被放弃的替代方案见 D6：把推导放进 storage 会让内存替身与 SQLite 各实现一份归一化语义，必然漂移。

### D8. 表与约束的追溯写在迁移文件里，不另开一份 schema 文档

每张表、每条约束在 `002_*.sql` / `003_*.sql` 里带一行注释，写明它对应裁决的哪一条（`R1`…`R8`）或 `AGENTS.md` §1.1 的哪一条不变量；集成用例里有一份"表名 → 出处"的映射，并断言它与 `sqlite_master` 里的实际表集合**互相覆盖**（多一张表、少一条映射都失败）。

不另写一份 schema 文档（例如未来层可能提议的 `docs/architecture/data-model-v1.md`）：裁决已经逐条写了"改什么、为什么"（R1–R8 表），迁移注释写"实际长什么样"，用例写"怎么证明"。第四份文档只会是这三份的副本，而 `PLANS.md` §4 要求一个事实只写一处。

### D9. 控制计划管栈，每层各有自己的 ExecPlan（2026-09-23 修订）

**Superseded by 本节（2026-09-23）**：本节原先写"四层共用这一份计划"。按并行开发的要求改为：本文件是**控制计划**，只放栈级事实（拓扑、base 链、关键路径、文件所有权、层间接口冻结、R1 覆盖表）；每一层在开工时建立自己的 ExecPlan，承载该层的设计与批次：

各层自己的计划：L1 `2026-09-23-e1-uncertain-create.md`、L2 `2026-09-23-storage-identity-membership.md`、L3 `2026-09-23-storage-control-facts.md`、L4 `2026-09-23-storage-sqlite-port.md`（L5/L6 沿用同一份，按批次追加）。

分层的判据是 `PLANS.md` §2「一个任务一份 ExecPlan」：六层是六个可独立验收、独立回滚的任务，不是一个任务。防重复的规则不变——层内细节只写在该层计划里，控制计划不复述；本文件 `Plan of Work` 的批次条目只保留闭环、文件集合、验证命令与回滚点。

### D10. 首次 MVP 发布之前不承担迁移与兼容成本（用户指令，2026-09-23）

第一个 MVP 发布之前**不存在需要保住的数据库**：002 / 003 在发布前可以整份重写，不需要纠正迁移、不需要兼容层、不需要双写或特性开关，也不为"以后可能要兼容"保留任何形状。设计按"哪个模型最自洽"决定，不按"改动量最小"决定。

这条**覆盖** `packages/storage/sqlite/src/migrations.ts` 里"已应用过的迁移文件不得再修改"的仓库约定（依据 `AGENTS.md` §5：用户指令优先于仓库约定）。该约定在存在需要保住的数据之后重新生效；在此之前它不是设计约束。运行器自身的语义不变：版本单调递增、从空库可重复、版本号在迁移体成功之后写入。

这条指令在本计划里改了三处：

1. **D5**：L4 的理由从"迁移不可修改"改为"模型可用性的决定性验证"。
2. **D6**：端口面按模型自洽决定，不再为"少改"而把原始层留在存储内部。
3. **Global Constraints**：删掉"已合并的迁移文件不得修改"，换成上面这条时限表述；本轮的验收里也不再出现"纠正迁移"这类成本项。

## Global Constraints

- **文件所有权（并行的前提）**。每层只改自己那一列；跨列改动要在 PR 描述里点名并说明理由。

逐层的**权威**文件清单在该层自己的 ExecPlan 的 `Global Constraints`（L1 `2026-09-23-e1-uncertain-create.md`、L2 `2026-09-23-storage-identity-membership.md`、L3 `2026-09-23-storage-control-facts.md`、L4–L6 `2026-09-23-storage-sqlite-port.md`），本文件不复述——2026-09-24 评审实测两份清单互不一致（`docs/architecture/README.md` 只在一份里、`merge-queue.md` 的节号对不上），复述就是制造第二份答案。跨列改动一律在 PR 描述里点名。

所有层共同的只读面：`packages/core/**`（L4–L6 的 `storage*.ts` 是例外，见层计划）、`packages/domain/**`（L2 的 `identity.ts` 除外）、`001_init.sql`，以及**不属于本层**的迁移文件与其它层计划。

- `packages/storage/sqlite` 只依赖 `@harness-projects/domain` 与 `@harness-projects/capabilities`；`pnpm run boundaries` 是这条的判据。
- 每个 PR：代码 ≤1000 行、文档 ≤1500 行，用 `node scripts/rule-checks.mjs size <该 PR 自己声明的 base>` 判定（栈内 base 是上一层，不是 `main`）。**Superseded by L1 级联（2026-09-23）**：括号里那句已不适用——#108 合并后 L1 的 base 就是 `main`（见 D2 的栈序表）；判据不变，仍是"该层自己声明的 base"，逐层的实际取值见各批次的验证块。
- 每个 PR 至少关联一个同仓 issue，并在描述里写清闭环、ExecPlan + Batch、`Closes` / `Refs`、真实验证证据、风险与回滚。
- 不新增运行时依赖；数据库只用 Node 内建的 `node:sqlite`。
- **首次 MVP 发布之前不承担迁移与兼容成本（D10）**：002 / 003 在发布前可以整份重写，不写纠正迁移、不做兼容层、不保留"以后可能要兼容"的形状。运行器的语义（版本单调、从空库可重复、版本号在迁移体成功之后写入）不变。
- 单文件 ≤ 200 行、单函数 ≤ 40 行（本计划自定，沿用持久化栈的约束；L4 若因此需要拆成多个模块，拆模块不算拆批次）。
- 只允许 rebase merge；agent 不自行合并 PR。
- 不写本机绝对路径、凭据、账号个人信息（`docs/development/publication.md`）。

## Plan of Work

### Batch L1 · #119 不确定创建的证据与裁决订正（`Refs #119`：验收 1 的墙钟缺口见本层计划）

**最小闭环**：行为 6 从 `inconclusive` 变成有证据的裁决，R8 的状态集有出处或明确保持开口。

**涉及文件**：`docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md`（本层自己的 ExecPlan，开工第一步建立）、`docs/architecture/gate-e1-uncertain-create.md`（新建的记录文件）、`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-ruling.md`、`docs/README.md`

**实验设计与步骤**：四条实验（重复创建计数、对账分支 A/B、draft 作用域）与状态集推导规则见该层自己的 ExecPlan 与 `docs/architecture/gate-e1-uncertain-create.md`；按 D9，层内细节只写在层计划里，控制计划不复述。

**验证**（在检出 `test/e1-uncertain-create` 的工作树根目录运行，全部期望退出码 0）：`node --test tests/contract`；`node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/rule-checks.mjs size origin/main`；`git diff --check origin/main...HEAD`（期望无输出）。

**回滚**：`git revert` 本层提交。本层只动文档与两个契约守卫（`tests/contract/e1-evidence-consistency.test.js`、`tests/contract/plan-facts-consistency.test.js`），三者一起回滚；回滚后 L0 的裁决回到"行为 6 待补证据"的状态，其它层不受影响。

### Batch L2 · #27 身份与成员表（`Refs #27`：验收 3 的声明式表达超出本栈授权面，见层计划）

**最小闭环**：身份、成员关系、字段值与投影在库层面成立、在端口面可触达，且 R1/R2/R3/R7 与 `AGENTS.md` §1.1 的相关不变量由约束而不是调用方保证。

**涉及文件**：`packages/domain/src/identity.ts`、`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage.js`、`packages/storage/sqlite/migrations/002_identity_membership.sql`、`packages/storage/sqlite/src/migrations.ts`、`tests/integration/identity-membership-schema.test.js`、L2 自己的计划 `2026-09-23-storage-identity-membership.md`（**该层计划拥有**，L2 开工时新建）

**步骤与实验**：见 `Global Constraints` 的 L2 行与 L2 自己的计划（`2026-09-23-storage-identity-membership.md`，**该层计划拥有**，D9）。

**验证**（在检出 `feature/storage-identity-membership-tables` 的工作树根目录运行，全部期望退出码 0）：`node --test tests/integration`；`node --test tests/contract`；`node_modules/.bin/tsc --noEmit`；`pnpm run boundaries`；先取本层声明的 base，再用它度量（**不要用本地分支名**：`merge-queue.md` §4.6 的操作结论是本地复核用真实父提交，分支名在合并、删除或强推后永久失效）：

```bash
BASE=$(gh pr view <本层 PR 号> -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)
node scripts/rule-checks.mjs size "$BASE"
node scripts/rule-checks.mjs disclosure "$BASE"
git diff --check "$BASE"...HEAD
```

L1 的 base 就是 `main`，因此它相对 `origin/main` 报数；L2–L6 一律用上面取到的 SHA，不要照抄别的层。

**回滚**：`git revert` 本层提交（迁移文件与用例一起回滚）。已运行过 002 的本地库**删除库文件重建**（D10：首次 MVP 发布前不存在需要保住的数据库，`docs/` 里没有也不需要有"备份恢复流程"）。

### Batch L3 · #28 执行、关系与写入表（`Refs #28`：重启验收在交付重启用例的那一层成立）

**最小闭环**：控制事实在库层面可关联、可定序、可恢复、在端口面可触达；R4–R8 落地，其中 R8 的状态集来自 L1 的观测。

**涉及文件**：`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage.js`、`packages/storage/sqlite/migrations/003_control_facts.sql`、`packages/storage/sqlite/src/migrations.ts`、`tests/integration/execution-relation-write-schema.test.js`、L3 自己的计划 `2026-09-23-storage-control-facts.md`（**该层计划拥有**，L3 开工时新建）

**步骤与实验**：见 `Global Constraints` 的 L3 行与 L3 自己的计划（`2026-09-23-storage-control-facts.md`，**该层计划拥有**，D9）。R8 的状态列取 `packages/domain` 的 `WriteState`，获知方式标注取自 L1 的记录，不在此复述。**L1 对 L3 提出的一条约束留在这里**（它是 L1 的发现，不在 L3 计划里）：**R8 的产品可见迁移约束**——产品可见的"结果不确定"只在对账**窗口结束后**仍给不出唯一结论时成立（判据的原文与窗口值在裁决 §4 的 R8 行与记录 §2；本文件不复述，2026-09-24 评审：本条上一轮被压缩掉，而它在别处没有原文，因此按原意补回并改为引用权威）。

**验证**（在检出 `feature/storage-execution-relation-write-tables` 的工作树根目录运行，全部期望退出码 0）：`node --test tests/integration`；`node --test tests/contract`；`node_modules/.bin/tsc --noEmit`；`pnpm run boundaries`；体量与发布面按 Batch L2 的四行配方，`BASE` 取本层 PR 的 `baseRefOid`。

**回滚**：`git revert` 本层提交。内存替身的 R4 语义与套件用例在同一提交里，回滚后契约套件回到上一层状态。

### Batch L4 · #163 端口机制与地基面（`Closes #163`：证据在本层，回读 `closingIssuesReferences` 确认）
**最小闭环**：core 的 bootstrap 路径跑在真实文件库上，事务语义正确（原子、失败回滚、嵌套运行时拒绝）。**涉及文件**：`packages/storage/sqlite/src/storage*.ts` 与 `index.ts`、`tests/contract/suites/storage*.js`（按端口面切分 + "用例总数不丢"守卫）、`tests/contract/storage-contract.test.js`、`tests/integration/storage-restart.test.js`、L4–L6 共用的计划 `2026-09-23-storage-sqlite-port.md`（**该层计划拥有**，L4 开工时新建）。**验证**：契约（地基组在两个实现上全绿）、集成、`tsc --noEmit`、boundaries，体量与发布面按 Batch L2 的四行配方（`BASE` 取本层 PR 的 `baseRefOid`；不要写分支名——分支在合并、删除或强推后永久失效）。**订正（2026-09-24）**：本行原先写 `size feature/storage-execution-relation-write-tables`，实测在全新 clone 上不可复跑。
### Batch L5 · #164 规划同步面（`Refs #164`）
**最小闭环**：平台观察落成原样事实（成员关系/字段值/观察/游标），"重复 N 次等同一次、旧观察不覆盖"在文件库上成立。
### Batch L6 · #120 / #5 执行与写入面 + 整端口（关联 #120 · `Refs #5`：验收 3 依赖 #187、#188 与 #132；`Closes` 的唯一权威是回读 `closingIssuesReferences`）
**最小闭环**：执行上下文/运行、关系路由、写尝试在 SQLite 上通过；**两个实现跑全部三组契约**；文件库重启逐字段不变。

### 收尾 · 文档、债务与交付

- [x] 在 `Outcomes & Retrospective` 里给出**表 → 端口方法**映射，逐张核对 002/003 建出的表都有写者与读者（D6 的验收项）；确实没有消费者的表要么补上方法，要么写明为什么它可以只被库层面用例证明（2026-09-26：见 `Outcomes & Retrospective`「目标表 → 端口方法映射」）
- [x] 更新 `docs/README.md` 的 Active 计划索引与 `docs/architecture/README.md` 的文档清单（后者由 L1 完成，若 L1 已改则此处只回读）（2026-09-26：本计划随栈顶 #175 移入 `docs/README.md` 的 Completed）
- [x] 六层逐层 `rebase --onto` 到新父并复验（`git rebase --onto <新父> <旧父>`），每层跑自己的验证命令（每轮级联逐层执行，见各层计划的 `Progress`）
- [x] 每层整理提交（折叠 fixup、删临时调试），建 backup ref 后精确 `--force-with-lease` 推送（第五、六轮按可独立回滚的交付物整理，见 `docs/review/2026-09-26-*` 记录）
- [x] 回读每层 head、base、checks、`closingIssuesReferences`，以及被引用 issue 的 `closedByPullRequestsReferences`（合并前逐层回读，命令见 D2）
- [x] 请求人类评审；不自行合并（合并由人类伙伴在第五、六轮评审任务中明确授权：无 P0 / P1 代码问题时修复后 rebase merge）

## Validation and Acceptance

| # | 验收项 | 判定证据 | 判定命令（回读；期望退出码 0） |
|---|---|---|---|
| 1 | 行为 6 有证据，R8 的状态列有类型与出处 | `docs/architecture/gate-e1-uncertain-create.md` + 裁决 §2.6 / §4 R8 | `git grep -n "WriteState" -- docs/architecture/gate-e1-ruling.md packages/domain/src/enums.ts`（期望 R8 行与 domain 枚举同轴；行为 6 的采纳权在人类伙伴） |
| 2 | 空库建出全部表，二次运行 no-op | 各层 `tests/integration` 的迁移用例 | 各层在检出自己分支的工作树根目录运行 `node --test tests/integration` |
| 3 | 每张表与每条约束可追溯到 R# 或不变量 | 表与约束 → 出处映射用例（互相覆盖断言） | 同上 |
| 4 | R1/R2/R3/R7 由约束保证 | L2 的拒绝用例 + 注入实验 | L2：`node --test tests/integration`；注入实验按「改坏 → 变红 → 还原 → 变绿」两步确认 |
| 5 | R4–R8 由约束与用例保证 | L3 的拒绝用例 + 注入实验 | L3：同上。R4 的定序跨行比较无法声明式表达，由端口职责 + 契约套件钉住，不在 DDL 里声称 |
| 6 | 同一套 storage 契约用例跑在两个实现上 | `node --test tests/contract` 摘要行 | 该层：`node --test tests/contract`（期望两个实现的组集合逐项相同） |
| 7 | 重启后身份、关系、执行上下文不变 | 重启用例（关句柄再打开） | L4–L6：`node --test tests/integration` |
| 8 | 事务失败不留半写行 | 重开句柄后的读断言 | 同上 |
| 9 | `storage/*` 只依赖 capabilities 与 domain | `pnpm run boundaries` | 该层：`pnpm run boundaries` |
| 10 | 每层体量与发布面合规 | `size` / `disclosure` / `git diff --check` | `node scripts/rule-checks.mjs size <该层自己声明的 base>`；`disclosure <同一 base>`；`git diff --check <同一 base>...HEAD`（期望无输出） |
| 11 | 每张冻结的表都能通过端口触达（不存在只有 DDL、没有写者或读者的表） | 该层契约套件用例 + 实现 + 该层 `Outcomes & Retrospective` 里的表 → 端口方法映射 | 该层：`node --test tests/contract`。**残余例外必须如实保留**：`sync_observation` 有写者无端口读回、`webhook_subscription` 无端口路径 |

**本表只写判据与判定命令，不写逐层结论。** 每层的实际判定结果由该层自己的 ExecPlan 的 `Progress` 与 `Outcomes & Retrospective` 持有；把上层的结论写进随 L1 进入 `main` 的本表，会让 `main` 声称尚未评审的层已通过（`AGENTS.md` §6 的可独立验收、合并、回滚）。

**R1 条件 3 的十项不变量**：`docs/architecture/release-gates.md` §2.1 的十项目前全部"无法判定"；本轮把哪些行推进到"有用例"，以各层 `Outcomes & Retrospective` 的实测与 `node --test tests/contract tests/integration tests/e2e` 的回读为准。完整的十项矩阵（每项绑定用例名、实现、失败注入与无网络复跑命令）属于 R1 门禁（issue #73），不在本栈交付范围。**2026-09-24 评审响应**：本文件原先在这里复述过一张"逐项 → 用例名"的表，那是上层合并后才为真的事实，已删除（原文在 git 历史里）。

## Progress

> **本节以下条目里的 head、用例数与 `ad76def` / `a646073` / … 这类 SHA 都是「记录这件事时那个检出长什么样」的观察时刻快照（2026-09-23，非当前值），不是可复核的现状**（`PLANS.md` §4）。重算命令：逐层 `gh pr list -R SingularityKChen/harness-projects --head <分支> --state all --json number,baseRefName,headRefOid,state`，加上该层自己的验证命令。层内细节与逐层结论归各层计划（D9），本节不复述。

- [x] (2026-09-23) 取证：读裁决、存储现状、端口面、契约套件、沙箱与看板
- [x] (2026-09-23) 栈设计定稿：栈序、文件所有权、关键路径（本文件）；原定四层，后按"验收单元必须等于交付单元"拆成六层（见 D2 与 Batch L4–L6）
- [x] (2026-09-23) Batch L1 · #119 不确定创建的证据与裁决订正（四条实验：重复创建计数 **2**（平台不去重）、对账唯一命中且搜索索引可见延迟 ≈9 s、平台显式拒绝后同形对账为空、draft 的对账作用域只有 project 条目连接；获知方式四个标注与 14 条未证明项逐条点名。**订正（2026-09-24 评审响应）**：原写"状态取值集合 = 4 个"把结果轴与获知方式轴混成一个集合；现按 §4 R8 行改成「类型取 `WriteState`、四个标注是获知方式」，`pending` 不再是被合并掉的候选；见 `docs/architecture/gate-e1-uncertain-create.md` §2/§3）
- [x] Batch L2–L6：**本文件不断言它们的交付状态**（`AGENTS.md` §6：一个 PR 要能独立验收、合并、回滚，而本文件随 L1 进入 `main`）。逐层状态与逐层结论回读：`gh pr list -R SingularityKChen/harness-projects --head <分支> --state all --json number,baseRefName,headRefOid,state`，加上该层自己计划里的验证命令。分支名见 D2 的栈序表。（2026-09-26：交付状态仍以 D2 的回读命令为准，本计划随栈顶 #175 归档）
- [x] (2026-09-23/24) 收口与两轮评审响应：回填栈序表与验收表；撤掉栈底对 L2–L6 的交付断言与裁决里的上层注记；R8 收敛到两轴；栈序表与验收表改成回读命令。取证：逐层 `gh pr list -R SingularityKChen/harness-projects --head <分支> --state all --json number,baseRefName,headRefOid`
- [x] 收尾 · 债务登记、栈内 rebase、整理提交、回读、请求评审（2026-09-26 完成，遗留见各层计划的「遗留问题与技术债务」与 #187 / #188 / #189 / #196 / #201–#204）

## Surprises & Discoveries

- (2026-09-23) 沙箱漂移：`fixture shared`（sandbox issue #2）已是 `CLOSED`，而 `docs/architecture/gate-e1-sandbox.md` §2.3 的对象清单仍按 `OPEN` 描述。证据：`gh issue list --repo SingularityKChen/e1-sandbox --state all --json number,title,state` 返回 `#2 CLOSED`。处理：L1 在自己的记录里写明差异，不改沙箱定义的对象清单（那份清单是"观测发生时对象长这样"的历史表述）。

- (2026-09-23) **声明的 base 被强推后 `size` 会退到 merge-base**：同一命令在不同 head 上给出相反结论（假超限 2078 vs 真实 1385）。机制与操作结论见 `docs/project-management/merge-queue.md` §4.6。

- (2026-09-23) **L2 上报：三张表没有端口入口**（`identity_projection` / `work_item` / `change_request` 是派生而非事实）。**处置归 L2 的层计划与它的 ADR**：这三张表删不删、删的理由是什么，由拥有它们的 L2 声明；本文件只记录"这条上报存在"。**订正（2026-09-24 评审）**：原文在这里写「已删除……见 ADR-0005」，而在 L1 的合并点上那两张表与那份 ADR 都还不存在——栈底文档不能把上层的设计结果写成过去时。

- (2026-09-23) 往已存在的栈追加层要先列出全部成员（`gh stack link 108 121` 被拒），完整实测见 `docs/project-management/merge-queue.md` §4.5。

- (2026-09-24) **为了压文档预算而"把层内细节压缩成指向层计划的一行"，删掉了一条任何层计划里都没有的约束**：2026-09-23 的栈级收口按 D9 把 L1–L3 的步骤清单压成一行（`Bottom Change Note` 记的理由是"文档预算只剩 35 行"），但 Batch L3 的**产品可见迁移约束**是 L1 的发现、不属于任何层计划，于是它随压缩一起消失，而同一份 `Bottom Change Note` 仍写"已加"。处理：按原意补回（见 Batch L3），并把判据写进规则——**压缩只允许删「别处有原文」的内容，压缩前要逐条确认原文在哪**。证据：`7da7e7d` 与 `e782464` 是**观察时刻快照，已不可从当前 head 解析**（这两个提交只挂在已删除的 backup 分支上）；按 `PLANS.md` §4，它只能作为历史记录，不能作为复核依据。

- (2026-09-23) **层计划 `Progress` 里的用例数会过期，栈级收口必须回读而不是照抄**：在 L2 的 head `ad76def` 上复跑，`node --test tests/integration` 实测 `tests 15 / pass 15 / fail 0`、`node --test tests/contract` 实测 `tests 408 / pass 408 / fail 0`，而 L2 计划 `Progress` 记的是"集成 16/16、契约 406/406"。两处都不是缺陷（L2 的用例集合在三个提交上稳定为 9 + 1 + 5 = 15；契约套件在回复轮后净增 2 条），是该计划记录停留在中间态。处理：控制计划按 head 实测回填，L2 计划自己的数字留给该计划的所有者订正——控制计划不复述层内细节（D9）。

## Decision Log

- **Decision**：首次 MVP 发布之前不承担迁移与兼容成本；模型按第一性原理取最自洽的形状，不按改动量最小取（D10）。
  **Rationale**：用户指令（2026-09-23）："在第一个 MVP release 之前，都不用考虑迁移和兼容问题。需要从系统角度和第一性原理考虑最佳设计而不是兼容。" 发布前不存在需要保住的数据库，`migrations.ts` 的"已应用迁移不得修改"在存在真实数据之后才构成约束。
  **Date/Author**：2026-09-23 / 用户指令，agent 记录

- **Decision**：v1 端口面覆盖每一张冻结的表，包括成员关系、字段值与对账游标（D6 修订）。
  **Rationale**：D10 取消了"少改"的理由之后，判据变成"哪一层拥有推导"——原样值归 storage、归一化归 core；端口触达不到原样值时那些表既没有写者也没有读者，模型不自洽。新增项全部由 R1/R2/R5 指名要求，不是猜测。
  **Date/Author**：2026-09-23 / agent

- **Decision**：控制计划与层计划分开，四层各自建 ExecPlan（D9 修订）。
  **Rationale**：并行开发要求每个工作流自带上下文；`PLANS.md` §2 的"一个任务一份 ExecPlan"里，四层是四个可独立验收的任务。
  **Superseded by D2 的六层栈序（2026-09-23）**：层数从四改成六（原 L4 拆成 L4/L5/L6），本决定的实质（控制计划管栈、每层各持 ExecPlan）不变，只有计数过期；原文保留。
  **Date/Author**：2026-09-23 / agent

- **Decision**：栈底取 PR #108 的分支，不取 `main`。
  **Rationale**：四层都引用裁决原文，以 `main` 为底时引用在 base 上不可解析；级联成本是本仓库已知且接受的代价。
  **Date/Author**：2026-09-23 / agent
  **Superseded by L1 级联（2026-09-23）**：#108 已合并、分支已删除，栈底就是 `main`；本层（L1）已在该栈底上完成，见 D2 的栈序表。本决定只在 L0 尚未合并时有效，原文保留。

- **Decision**：#119（不确定创建的证据）放进本轮，作为栈内 L1。
  **Rationale**：R8 禁止在证据前冻结状态集，而 #28 要建那张表；发布前可重写模型，不把兼容成本当作推迟证据的理由。
  **Date/Author**：2026-09-23 / agent

- **Decision**：本轮不扩展 `Storage` 端口面（D6）。
  **Superseded by D6 修订与 D10（2026-09-23）**：理由（"无消费者就猜接口"）在 D10 取消兼容成本之后不再成立；现决定端口面覆盖每一张冻结的表。原文保留以记录取舍过程。
  **Rationale**：裁决冻结的是表与约束；成员关系与字段值的唯一消费者是尚未开发的核心投影改造，现在发明接口等于无消费者地猜公共接口。
  **Date/Author**：2026-09-23 / agent

- **Decision**：R4 落在现有 `recordObservation` 上，不改签名（D7）。
  **Rationale**：`ProviderObservation` 已有 `sourceVersion` 与 `receivedTime`，足以表达定序；改签名会波及 `packages/core`，超出本轮边界。
  **Date/Author**：2026-09-23 / agent

- **Decision**：不另写 schema 文档，追溯写在迁移注释与用例映射里（D8）。
  **Rationale**：裁决的 R1–R8 表已写"改什么、为什么"，再写一份 schema 文档会构成第三份副本，违反 `PLANS.md` §4。
  **Date/Author**：2026-09-23 / agent

## Idempotence and Recovery

- 验证命令只读且可重复；注入实验都要求还原并复跑确认变绿。迁移运行器幂等（重复运行只报"无事可做"），测试各用自己的临时目录。
- 发布前 002 / 003 可整份重写（D10）；首次 MVP 发布后才恢复"历史迁移不可修改"。
- 级联用 `--onto <新父> <旧父>` 并逐层复验；分支已推送后改写历史先建 backup ref，再用精确 old head 的 `--force-with-lease`。
- **堆叠 PR 的看板副作用**：多层引用同一批 issue 会触发 #115 记录的形态，每层合并后回读该 issue 的 `Engineering` 字段，漂移则按 #115 处理。
- 沙箱观测只写夹具：不碰本仓库自身与其看板。

## Interfaces and Dependencies

**本轮对内提供的接口**

```text
packages/storage/sqlite/src/migrations.ts
  MIGRATIONS: readonly { version: number; file: string }[]   # 002、003 由 L2/L3 追加
packages/storage/sqlite/src/index.ts
  openDatabase(location: string | ':memory:'): WorkspaceDatabase
  migrate(db: WorkspaceDatabase): { applied: number[]; version: number }
  createSqliteStorage(location: string | ':memory:'): Storage   # L4 新增
```

**依赖的仓库设置与外部条件**

- Node 26（`node:sqlite`），无第三方运行时依赖。
- 分支保护：线性历史、`PR Fast Gate`、批准、rebase merge。
- `gh` CLI 已登录 `SingularityKChen`（`repo`、`project` 作用域）；`gh stack` 扩展 v0.1.0 已安装。
- 沙箱：私有仓库 `SingularityKChen/e1-sandbox`、Project A `11`、Project B `12`（2026-09-23 存在性已回读）。
- 看板字段 ID 与选项 ID 以 `docs/project-management/README.md` §3 为准。

**依赖的既有决策**

- `docs/architecture/gate-e1-ruling.md` §4 的 R1–R8。

## Outcomes & Retrospective

**本层（L1）的交付状态用 D2 的回读命令判定；L2–L6 的交付状态由各自层的计划与 PR 回读，本文件不断言**（`AGENTS.md` §6：一个 PR 要能独立验收、合并、回滚，而本文件随 L1 进入 `main`）。逐层体量与注入实验的实测摘要见各层自己的 `Outcomes & Retrospective`，不在此复述（D9）。

**目标表 → 端口方法映射由拥有那些表的那一层持有**：表与约束的出处写在迁移注释与集成用例的映射里（D8），逐表 → 端口方法的对应写在 L2 / L3 的层计划里（D9）。本文件不复述——2026-09-24 评审实测：本文件写「已删除」与表数量，而在 L1 的合并点上那两张表与 ADR 都还不存在。

**未覆盖风险**：**本文件不断言各层的代码行为与遗留编号**——它们随承载它们的层落地，编号在级联与重排后必然漂移（2026-09-24 评审实测：本文件写的「L6 遗留 11–13」在栈顶其实是 15–17，且漏掉了与遗留 5 并列的第二个阻塞点）。权威清单在各层计划的「遗留问题与技术债务」一节，逐层回读命令见 D2。

本文件只保留一条栈级判据：**"某层的验收全绿"不得读成"SQLite 已经可以当 core 的 storage"**——core 与 SQLite 之间的阻塞点由 L5/L6 的遗留清单持有，且必须同时有同仓 issue 承载（收口条件与后果见层计划）。

## Bottom Change Note

- 2026-09-23：首次创建。原因：Gate E1 裁决给出 `revise` 与 R1–R8，本地数据模型 v1 的冻结条件变成一份可执行的清单；本计划把这份清单拆成四层栈，并给出关键路径与并行支路。
- 2026-09-23：把栈链接的实测写进 `docs/project-management/merge-queue.md` §4.5，并把它加进 L1 的文件集合。原因：这条机制是后续三层创建 PR 时直接要用的操作结论，放在 `Surprises & Discoveries` 里会让每个执行者重新发现一次；§4 是栈机制的唯一权威处。
- 2026-09-23：按用户指令订正 D5、D6、D9，新增 D10，并同步 Global Constraints、文件所有权、四个批次与验收表。原因：用户明确"第一个 MVP release 之前不考虑迁移和兼容，按第一性原理取最佳设计"；原计划把"迁移不可修改"当作硬约束，并据此把原始层留在存储内部，导致五张表没有写者。订正后端口面覆盖每一张冻结的表，四层各自持有 ExecPlan。
- 2026-09-23：按 L1 的第三轮评审意见就地订正五处过期的栈底事实（`当前事实` 第 1 行、D2 标题与栈序表、被放弃的方案、Global Constraints、Decision Log），把体量口径改成"每层用该层自己声明的 base"，订正 `Surprises & Discoveries` 里写反的 `size` 方向，并在 Batch L3 加一条 R8 的产品可见迁移约束。原因：#108 已合并、`test/e1-ruling` 已删除，L1 的 base 是 `main`；原文一律保留，标注见各处。
- 2026-09-23：把原 L4（#120）按"验收单元必须等于交付单元"拆成 L4/L5/L6（#163 / #164 / #120），写明切分判据与配套的契约套件分组守卫。原因：原闭环含"整套契约 + 重启 + 幂等 + 边界"，中间态无法独立验收，连续三次零产出。
- 2026-09-23：栈级验收证据收口。按六层实测回填 D2 的 head 与 base 链（含 L2 声明 base 与实际切点 `85c7eb3` 不一致这条）、验收表 2–11 项、`Progress` 与 `Outcomes & Retrospective`（表 → 端口方法映射 + 未覆盖风险）；把仍写"四层"的六处表述改成六层，文件所有权表补 L4–L6 与回复轮实际改动的文件；验收表第 11 项由"未通过"改为"通过（分类/连接表已按 ADR-0005 删除）"并保留 `sync_observation`/`webhook_subscription` 两处例外。原因：栈级验收判 `accept_with_changes`——代码与测试无缺陷，但控制计划的栈级事实停在四层、验收表停在"待验证"，评审前必须与实测一致。同时按 D9「层内细节只写在层计划里」把 L1–L3 已完成的步骤清单与实验设计压缩为指向层计划的一行：那些内容在各层计划里都有原文，控制计划留着就是同一事实的第二份副本（`PLANS.md` §4），而文档预算只剩 35 行。
- 2026-09-24：评审响应轮。撤掉栈底对 L2–L6 的交付断言与裁决里 R4/L5、R8/L3 两处上层注记；R8 收敛到「结果轴 `WriteState` + 获知方式标注」两条轴；栈序表与验收表改成回读命令；**补回 2026-09-23 压缩时删掉的 Batch L3 产品可见迁移约束**并订正文件所有权表（原文比对见 `Surprises & Discoveries`）。原因：PR #121 的 2026-09-24 评审指出跨层计划在合并点写了不为真的事实、且压缩丢了一条只存在于本文件的约束。
- 2026-09-24（第四轮评审响应）：删除本文件里属于上层的副本——「当前事实」空节、只剩表头的「不在关键路径上」表、与 D6 无关的「被放弃的方案」表、整节「目标表 → 端口方法映射」；D2 的 `Closes` 列换成回读命令（唯一权威是 GitHub），六个 Batch 标题不再写死 `Closes #N`；`size` 基线、回滚流程、行为 6 的采纳权、R8 产品可见约束四处改成回读命令或指向权威。原因：本文件随 L1 进入 `main`，在每个合并点只能写那个时点为真的事实，而它同时承担了整栈设计文档的角色。