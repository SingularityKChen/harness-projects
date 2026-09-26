# 栈评审响应 ExecPlan（PR #121 / #122）

> 状态：Completed（2026-09-26：处置已随 L1 / L2 合入，随栈顶 #175 归档）
> 创建：2026-09-24
> 范围：处置 PR #121（栈 L1）与 #122（栈 L2）2026-09-24 那一轮的 21 条 inline 意见，按共享根因修复 spec / plan / 代码 / 测试，并按栈序级联 L3–L6
> 上游输入：`docs/review/2026-09-24-pr-121-mvp-review.md`、`docs/review/2026-09-24-pr-122-mvp-review.md`、`docs/review/responding.md`、`PLANS.md` §4、`AGENTS.md` §6 §7 §10
> 本计划随 L2 落地：L1 的文档预算在开工时为 1395 / 1500（`docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md` 426 行 + `docs/architecture/gate-e1-uncertain-create.md` 516 行），放不下本计划与两份评审记录；两份记录覆盖两层，因此与计划一起随 L2 进入仓库。L1 的 PR 描述指向 L2。

## Purpose / Big Picture

完成后，一个只读仓库的人可以做到三件事：

1. 打开 `docs/architecture/gate-e1-ruling.md`，看到 R4 / R8 只写**本层（L1 / #119）已经确立的事实**，不再出现「已被 L3 / L5 取代」这类指向未合并实现的门禁断言；
2. 打开 `docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`，看到栈的**拓扑、每层目标与判定命令**，而每一层的交付状态是一个可复跑的回读命令，不是写死在文档里的结论；
3. 对着同一个库跑 `node --test tests/contract tests/integration`，看到「同一外部对象进入两个工作区只产生一条外部身份」这条 Gate E1 行为 1 被断言，且 `#27` 六条验收逐条有判定证据。

最小成功证据（三条，缺一条本轮不算完成）：

| # | 证据 | 判定命令（在检出对应分支的工作树根目录运行） |
|---|---|---|
| 1 | L1 的门禁文档与索引不再包含任何以未合并层为真的断言 | `git grep -n "Superseded by L[2-6]" origin/test/e1-uncertain-create -- docs/architecture docs/README.md`（期望无输出） |
| 2 | 行为 1 在库层面成立：同一连接锚点 + 同一对象在两个工作区只得到一条身份、一个实体、两条成员关系 | `node --test tests/integration`（期望 `fail 0`） |
| 3 | 内存替身按契约套件跑判别性断言（SQLite 侧在 L4 注册地基组、L5/L6 注册同步组），且套件能区分项目分量、孤儿字段值与投影引用 | `node --test tests/contract`（期望 `fail 0`） |

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 连接锚点 | 一个工作区与某个 provider 账号之间的连接本身；跨工作区共享，`external_identity` 的键挂在它上面 |
| 工作区挂载 | 「某工作区启用了某连接」这一条工作区作用域的事实（domain / enabled / is_default） |
| 结果轴 | 一次外部写入**结果是什么**（`WriteState`：pending / saved / unknown / conflict / failed） |
| 获知方式轴 | 这个结果**是怎么得知的**（响应确认 / 对账唯一命中 / 平台显式拒绝 / 无法判定） |
| 判别性用例 | 缺陷存在时必须变红的用例；每条都要配一次注入实验（改坏 → 变红 → 还原 → 变绿） |
| 时点事实 | 某一层合并到 `main` 时已经为真的事实；跨层计划在每个合并点只能写时点事实 |

### 开工时状态（2026-09-24 快照，不可复跑；当前状态回读 `gh pr list -R SingularityKChen/harness-projects --state all`）

- L1 head `21ece2a`（5 个提交），base `main`；L2 head `2fd1b32`（4 个提交），base = L1 head。
- 栈序：L1 #121 → L2 #122 → L3 #157 → L4 #167 → L5 #170 → L6 #175，全部 OPEN。
- 2026-09-24 的评审在 L1 留 11 条、L2 留 10 条 inline 意见，全部未 resolve。评审记录写在 `.worktrees/w7-e1-5` 与 `.worktrees/w8-s2`，未提交。
- 本轮已用 10 个只读对抗验证 agent 独立复现每条意见（见 `Surprises & Discoveries`）：19 条属实或核心属实，2 条过严。

### 相关文件

| 文件 | 角色 |
|---|---|
| `docs/architecture/gate-e1-ruling.md` | 门禁权威文档：六条行为裁决 + revise 清单 R1–R8 |
| `docs/architecture/gate-e1-uncertain-create.md` | L1 的 E1-5 证据记录（#119 的交付物） |
| `docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md` | 跨六层的控制计划 |
| `tests/contract/e1-evidence-consistency.test.js` | 证据守卫：断言记录与沙箱定义的计数一致 |
| `packages/storage/sqlite/migrations/002_identity_membership.sql` | L2 的迁移：身份、成员关系、字段值、投影 |
| `packages/capabilities/src/storage.ts` | `Storage` 端口契约（公共接口） |
| `packages/providers/fake/src/storage.ts` | 内存替身：契约套件的唯一执行者 |
| `tests/contract/suites/storage.js` | 两个实现共用的契约套件 |

## Design / Spec

### D1. 21 条意见收敛成 6 个根因，按根因修而不是按条修

| 根因 | 机制 | 覆盖的意见 |
|---|---|---|
| **RC-1 时点事实与目标设计混写** | 跨层控制计划与门禁文档按**整栈终态**书写，而它们随栈底进入 `main`；文档里因此出现「L2–L6 已交付」「R4 已被 L5 取代」这类在其合并点不为真的断言 | #121-1、#121-2、#121-3、#121-8 |
| **RC-2 状态轴混淆** | `pending_external_write` 的取值集合按「我们有哪些观测」自下而上推导，把**结果轴**与**获知方式轴**装进同一个集合；于是本地生命周期阶段 `pending` 因「没有平台观测」被合并进 `uncertain`，而 L3 立刻把它拆回来 | #121-4 |
| **RC-3 守卫用宽松正则 + 全局下限** | 证据守卫靠正则发现 Markdown 结构、用跨文档最低计数兜底，证明的是「至少找到若干像实验的片段」，不是「所有应有实验都被发现」 | #121-7 |
| **RC-4 文档与实现漂移，且无清扫机制** | `PLANS.md` §4 的「一个事实只写一处」「就地标注 Superseded by」「易失状态写成回读命令」只有散文规定，没有机械检查；PR 描述又是计划内容的第二份副本 | #121-5、#121-9、#121-10、#121-11、#122-6、#122-7、#122-9 |
| **RC-5 契约权威不明：一个契约、两个实现、零对照** | 端口注释、SQLite DDL 与内存替身三者对「storage 强制什么」给出不同答案；契约套件只跑替身，于是「套件绿」不蕴含「SQLite 绿」，而套件没有断言可以判定谁对 | #122-3、#122-4、#122-5、#122-8、#122-10 |
| **RC-6 身份键锚在单工作区实体上** | `external_identity` 的键挂在 `provider_binding` 上，而绑定被 `workspace_id NOT NULL` 限定为单工作区；ADR-0001 的 Consequence 与 Gate E1 行为 1 因此表达不了，#27 Scope 明列的 connector accounts 既没建也没登记推迟 | #122-1、#122-2（部分） |

### D2. RC-1 的修法是**去掉那个位置**，不是改对那个值

`PLANS.md` §4 要求易失状态写成「回读命令 + 期望」。控制计划的每一层因此只保留三样东西：**层目标、判定命令、期望**。交付状态由命令回读，不写进文档。门禁文档（`gate-e1-ruling.md`）是权威文档，只能写**本层已经确立**的事实：R4 的键形状不是 L1 的发现，R8 的五态也不是——它们的偏离注记随承载它们的层（L5 / L3）落地。

判据：栈必须自下而上合并，因此 L1 合并后 `main` 上的门禁完成条件不能依赖尚未评审的代码。`AGENTS.md` §6 要求每个 PR 可独立验收、合并、回滚；把上层实现写成既成事实同时破坏这三条。

### D3. RC-2 的修法是**把一条轴拆成两条**，并把权威收敛到 domain

- **结果轴**（唯一权威）：`packages/domain/src/enums.ts` 的 `WriteState` 五态。R8 直接采用它，不再另立一套取值。
- **获知方式轴**（L1 的发现）：`confirmed` / `reconciled` / `rejected` / `unresolved` 四值，是**证据来源标注**，映射到结果轴：`confirmed`→`saved`、`reconciled`→`saved`、`rejected`→`failed`、`unresolved`→`unknown`。
- `pending` 是结果轴上的合法取值（写入已发起、尚无结论），**不需要平台观测**——D6 的「每个候选取值至少指向一条观测」约束的是「某个状态是怎么被知道的」，不是「某个本地阶段必须被平台证明」。
- **产品可见**的人工确认以「`state = unknown` 且对账已执行且未给出唯一结论」为条件；`pending` 不得单独触发。

这样修的直接后果：R8 与 `packages/domain` 的 `WriteState`（结果轴的唯一权威）**同轴**，「Superseded by L3」这条注记不再需要存在——RC-2 与 RC-1 的一半同时消失。

### D4. RC-3 的修法是把「发现」换成「声明」

守卫不再从 Markdown 里*猜*有哪些实验节，而是持有一份**逐文档声明**：每份记录文档期望出现的实验节编号集合。发现正则只用来定位，级别与编号都必须与声明逐项相符；少一节、改名、降级、多一节都响亮失败。全局下限保留，但只作为「文档集合本身没被清空」的第二道保险。

### D5. RC-5 的修法是先定权威，再让两个实现都服从它

契约的权威是**端口注释 + 共享套件**，不是任何单个实现。因此：

1. 端口逐条写明 storage 强制什么、不强制什么（引用完整性、每个实体至多一个 primary、后者胜时被取代条目的字段值语义、`listMemberships` 的排序）。
2. 内存替身按端口补齐（它现在比 SQLite 宽松，是分叉的来源）。
3. 套件为每条**复合键的每个分量**补判别性断言——现有用例只覆盖了部分分量（`project_external_id` 与 `item_external_id` 都没被钉住）。

`capabilities/src/storage.ts:125-127` 已经写了「同一 (workspaceId, projectExternalId, contentKind, contentExternalId) 后者取代旧行」，因此「被取代条目的字段值怎么办」不是自由裁量，是端口欠定义——补齐它。

### D6. RC-6 的修法是把「连接」与「挂载」拆成两个事实（用户裁定，2026-09-24）

`provider_binding` 现在同时装着两件事：与 provider 账号的连接，以及「某工作区启用了它」。拆开：

- `provider_binding` → **连接锚点**：`(id, implementation_key)`。`id` 由调用方给定，同一个 `id` 就是同一个连接，可被多个工作区挂载。
- `workspace_binding` → **工作区挂载**：`(workspace_id, binding_id, domain, enabled, is_default)`，唯一索引落在这里。
- `external_identity` 的键形状 `(binding_id, external_kind, external_id)` **逐字不变**——裁决 R1 的「键形状不变」继续成立，改的只是 `binding_id` 指向的实体作用域。

判据（三条权威文档同时满足，不需要新的门禁裁定）：#27 的 Scope 明列 connector accounts；ADR-0001 的 Consequences 要求跨工作区复用；裁决 §2.1 已把行为 1 判 `pass`。三条都指向同一个形状，而 002 既没建也没登记推迟。

**被放弃的方案**：由人类裁定「一个库只放一个工作区」并删掉多工作区键——代价是放弃一条已判 `pass` 的行为、ADR-0001 的 Consequence 与 `AGENTS.md` §1.1 不变量 6 的跨工作区谱系复用，属于反向裁定，采纳权不在 agent。

### D7. #27 的六条验收逐条处置

| 验收 | 处置 |
|---|---|
| 1 第二个**启用的** planning 绑定被数据库拒绝 | **改实现到字面**：新增 `(workspace_id) WHERE domain = 'planning' AND enabled = 1` 的唯一索引，并给 `domain` 加 CHECK（字面集合绑定到 `CapabilityDomain`，杜绝 `'Planning'` 绕过）。现有用例 `identity-membership-schema.test.js:138` 断言的恰是相反行为，随实现反转 |
| 2 change request 成员关系不产生工作项 | 强制点在 core 的 `entityKindFor`（`packages/core/src/identity.ts:35`）+ e2e（`tests/e2e/chain-bootstrap.test.js:46`），**不在 storage**。把 ADR-0005、层计划与索引的措辞改成真实强制点；集成用例改成断言 storage 真正保证的那条（同一实体一条投影），不再叫「行为 2」 |
| 3 恰好一个 primary | 库层面保**至多一个**（现有部分唯一索引），**恰好一个**由写入生命周期保证（`ensureEntity` 建实体即建 primary；`promoteDraftToIssue` 保持恰好一个）。补生命周期断言与替身镜像，并在端口写明两段的分工 |
| 4 表与约束可追溯 | 出处注释补到**约束级**（主键、外键、唯一索引各一行），出处用例从「marker 存在」改成逐约束检查 |
| 5 无凭据列 + 显式审查 | 补一段显式 schema 审查（逐列审计结论）并加一条机械守卫：任何列名命中 token / key / password / secret / credential 即失败 |
| 6 从空库可重复 | 已满足，保持 |

## Global Constraints

- 本轮只改 L1 与 L2 的文件集合（见 `Plan of Work` 各批的「涉及文件」），以及级联所必需的 L3–L6 中直接引用 `provider_binding.workspace_id` 的行。
- 不改 `packages/core`、`packages/controller`、`packages/ui*`、`apps/*`。
- 不新增运行时依赖；数据库只用 Node 内建的 `node:sqlite`。
- 不写本机绝对路径、凭据、账号个人信息（`docs/development/publication.md`）。
- 已推送分支改写历史：先建 backup ref，再用精确 old head 的 `--force-with-lease`。
- 每个 PR 代码 ≤1000 行、文档 ≤1500 行，用**该层自己声明的 base** 度量（L1 用 `origin/main`，L2 用 L1 的分支）。
- 只允许 rebase merge；agent 不自行合并 PR。

## Plan of Work

**压缩说明（2026-09-24，第三轮评审响应）**：本节原先逐条列了 Batch 1–7 的步骤、验证与回滚（约 100 行）。这些批次已全部执行完毕，且第三轮评审的收敛计划（`docs/exec-plan/completed/2026-09-24-review-root-cause-convergence.md`）已按"一个事实只写一处"重述了同一批工作与它们的结果；保留两份逐条步骤只会互相漂移。下面只留批次名与执行结果，逐条细节与证据见该计划。

| 批次 | 内容 | 结果 |
|---|---|---|
| 1 | L1：门禁文档与控制计划只写时点事实（RC-1） | 已完成；第三轮评审实测仍有残留，已在该计划的 Batch A 收口 |
| 2 | L1：R8 收敛到结果轴 + 获知方式轴（RC-2） | 已完成；`pending` / `unresolved` 的边界在该计划的 Batch A 补齐 |
| 3 | L1：证据记录与守卫的判别力（RC-3、RC-4） | 已完成；守卫的两个逃逸（记录内改绑、本层计划不在范围）在该计划的 Batch A 收口 |
| 4 | L2：连接锚点与工作区挂载拆开（RC-6） | 已完成（ADR-0006） |
| 5 | L2：#27 验收逐条对齐 + 契约权威（RC-5） | 部分完成：验收 3 的字面（恰好一个 primary 由库保证）本层未落地——代价是 `putEntity` 同事务写 primary 与套件前置改写，不是端口签名变更（第四轮已推翻，第五轮订正）；该计划的 Batch B 改为 `Refs #27` + #190 |
| 6 | L2：计划与文档清扫（RC-4） | 已完成；本计划自身的索引与状态矛盾在该计划的 Batch B 收口 |
| 7 | 级联与交付 | 由该计划的「收尾」批次统一执行（六个 PR 一起级联、整理提交、回读、回复） |

**回滚**：每一批都落在单个提交上，`git revert` 该提交即可；分支已推送过，改写历史前先建 backup ref。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | L1 门禁文档不含未合并层断言 | `git grep "Superseded by L[2-6]"` 无输出 | 通过（`d26cfe7`，无输出） |
| 2 | R8 状态集在仓库内只剩一套 | R8 行、L1 记录 §2、ADR-0004 三处同轴 | 通过（三处都写「类型取 `WriteState`、四个获知方式标注」） |
| 3 | 证据守卫对改名 / 降级 / 少节响亮失败 | 六组注入实验各自变红，还原后绿 | 通过（6/6 红 → 还原 5 pass / 0 fail） |
| 4 | 行为 1 在库层面成立 | 集成用例 + 注入实验 | 通过（变异「身份键加回 `workspace_id`」→ 19 个用例红 15 个） |
| 5 | #27 六条验收逐条有判定证据 | 集成用例 + 显式审查段 | 通过（验收 1/3/5 各补实现与断言；六条逐条在计划验收表 1–19 项里） |
| 6 | 两个实现在同一套断言下不分叉 | 契约套件 + 五格分歧表的逐格断言 | 通过（20 组注入实验全部 RED、还原后 GREEN）。「两个实现跑同一套」是目标状态，本合并点只有内存替身注册：复核 `node --test tests/contract`（期望 fail 0），SQLite 侧在 L4/L5/L6 注册（见 `tests/contract/storage-contract.test.js` 的注释） |
| 7 | 计划与索引不再描述已删除设计 | `git grep` 断言 | 通过（残留命中全部带 `Superseded by` 或属评审记录） |
| 8 | 每层体量与发布面合规 | `size` / `disclosure` / `git diff --check` | 通过（L1 251/1000 + 1486/1500；L2 999/1000 + 1016/1500；L3 439/1000 + 186/1500；三层 disclosure 与 `diff --check` 均通过） |
| 9 | L3–L6 级联后各自全绿 | 逐层复跑 | 见 `Progress` 与两个 PR 的回复 |

## Progress

- [x] (2026-09-24 10:24 CST) 用 10 个只读对抗验证 agent 独立复现 21 条意见；19 条属实或核心属实，2 条判为过严
- [x] (2026-09-24 10:40 CST) 根因收敛（D1）与用户裁定 RC-6 走「拆开连接锚点与工作区挂载」
- [x] (2026-09-24 11:05 CST) **订正**：按评审给出的 `7da7e7d` / `e782464` 原文比对，「压缩删掉了上一轮第 8 条的修复」属实，对抗验证把它判成「过严」是错的；另一条「顺序」在重读评审原文后也不再算过严（评审给的是「约定顺序**或**声明无序」两个方向）。最终 21 条全部属实
- [x] (2026-09-24 11:30 CST) Batch 1–3 · L1（4 个提交，head `d26cfe7`；契约 452 / 452、`size` 251/1000 + 1486/1500、disclosure 与 `diff --check` 通过）
- [x] (2026-09-24 12:05 CST) Batch 4–6 · L2（3 个提交，head `4d86a96`；520 / 520 + mvp0 7 / 7、tsc 0、boundaries 7 / 7、`size` 999/1000 + 1016/1500）
- [x] (2026-09-24 12:20 CST) L1 / L2 / L3 已 push 并回读（`gh pr checks` 三个 PR 全绿）；21 条 thread 逐条回复并 resolve
- [x] (2026-09-24 13:10 CST) Batch 7 · L4–L6 级联（三层各自复跑全绿、未 push 前先建 backup ref）：L4 `2623372`（契约 486 / 486、集成 30 / 30、e2e 38 / 38、mvp0 7 / 7、tsc 0、boundaries 7 / 7、代码 1000 / 1000）；L5 `f61e16b`（契约 579 / 579、集成 40 / 40、代码 828 / 1000）；L6 `22ac23d`（契约 597 / 597、集成 45 / 45、代码 611 / 1000）。三层 `disclosure` 与 `git diff --check` 均通过，无 `fixup!` 残留
- [x] (2026-09-24 13:25 CST) 六层按栈序 push 并回读：`gh pr view <n> --json headRefOid,baseRefName` 的 base 链完整（#121→main、#122→#121、#157→#122、#167→#157、#170→#167、#175→#170）

## Surprises & Discoveries

- (2026-09-24) **评审意见与作者回复之间存在一次未被记录的强推**：评审锁定 L1 head `74086b2` / L2 head `7138a5d`，而开工时远端是 `21ece2a` / `2fd1b32`，两者互不为祖先。逐文件比对后确认 L1 的内容在两次 head 之间**没有变化**（只有 `docs/README.md` 与 `merge-queue.md` 因级联冲突解决而改动），即 21 条意见全部仍然成立，不是「已修但未回复」。证据：`git diff 74086b2 21ece2a -- docs/architecture docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md tests/contract/e1-evidence-consistency.test.js` 无输出。
- (2026-09-24) **两条意见过严**：① #121-6 的「预算挤压造成内容丢失」查不到可核对证据（`#119` Scope 不含控制计划这一半属实，但「上一轮第 8 条的修复被删掉」在仓库文本与历史里都找不到对应物），P2 定级偏高；② #122-10 的 `listMemberships` 顺序差异事实成立，但端口与套件都未承诺顺序，**没有排序合同就没有实现错误**，作为 P3 缺陷不成立。
- (2026-09-24) **三处转述被夸大**，回复时要逐条点名：① #121-4 说 D6 要求「每个状态都要有平台观测」——D6 原文只要求「每个候选取值至少指向一条观测」；② #121-4 说「两个成因各有独立观测」是夸大——该表述在狭义上成立（实验 1 多命中、实验 4 空各一次），夸大的是把实验 2 的**搜索路径**空窗口算作允许对账路径的证据；③ #121-7 说「守卫仍有 4 种逃逸」——`####` 降级、未索引文档、变量重复绑定三类已被现有断言拦住，仍可复现的只有**改名**与 `##` 二级标题。
- (2026-09-24) **#122-4 分歧表的第 1 行在 SQLite 侧的表现与评审写法不同**：评审写「后者胜取代 item-1 后读 item-1 的字段值 → `[]`」，实测裸插会被唯一约束拒绝（`UNIQUE constraint failed: project_item_membership...`）；要得到 `[]` 必须先按端口语义删除旧成员及其字段值。结论不变（语义欠定义），但复现步骤要写对。
- (2026-09-24) **L1 的文档预算只剩 105 行**（1395 / 1500），本计划与两份评审记录因此随 L2 落地。

## Decision Log

- **Decision**：RC-1 按「去掉那个位置」修，而不是把值改对。
  **Rationale**：`PLANS.md` §4 已要求易失状态写成回读命令；把交付状态写进跨层计划等于给每个合并点埋一个必然过期的值。控制计划只保留层目标、判定命令与期望。
  **Date/Author**：2026-09-24 / agent

- **Decision**：R8 的状态集收敛到 `packages/domain` 的 `WriteState`，L1 的四个取值降为获知方式标注。
  **Rationale**：`packages/domain` 是枚举的单一权威（`AGENTS.md` §2），`WriteState` 是结果轴的唯一权威；两条轴混在一条集合里是 `pending` 被合并又被拆回的直接原因。修轴之后「Superseded by L3」这条注记不再需要存在。
  **Date/Author**：2026-09-24 / agent

- **Decision**：RC-6 走「拆开连接锚点与工作区挂载」，不改 `external_identity` 的键形状。
  **Rationale**：用户裁定（2026-09-24）。三条权威文档同时指向这个形状：#27 Scope 明列 connector accounts、ADR-0001 Consequences 要求跨工作区复用、裁决 §2.1 已把行为 1 判 `pass`；而键形状逐字不变使裁决 R1 的「键形状不变」继续成立，因此不需要新的门禁裁定。
  **Date/Author**：2026-09-24 / 用户裁定，agent 记录

- **Decision**：#27 的验收 1 改实现到字面，不申请收窄。
  **Rationale**：`AGENTS.md` §1.1 不变量 1（一个工作空间同一时刻只有一个 Planning 事实源）要求第二个**启用的** planning 绑定被拒绝；现有实现只拒绝「启用且默认」，且本 PR 的用例断言的恰是相反行为——这是缺陷不是取舍。收窄验收需要人类批准，而按字面实现不需要。
  **Date/Author**：2026-09-24 / agent

- **Decision**：本计划与两份评审记录随 L2 提交。
  **Rationale**：L1 的文档预算在开工时为 1395 / 1500，放不下；两份记录覆盖两层，与计划同批进入仓库更自洽。
  **Date/Author**：2026-09-24 / agent

## Idempotence and Recovery

- 本计划所有验证命令只读且可重复；注入实验一律「改坏 → 变红 → 还原 → 变绿」两步确认。
- 迁移与测试各用自己的临时目录与临时库，不共享状态。
- 级联用 `git rebase --onto <新父> <旧父>`，逐层复跑该层自己的验证命令；「变基成功」不等于「内容正确」。
- 每层分支改写前先建 backup ref（`backup/<branch>-pre-review-response`），恢复即 `git reset --hard <backup ref>`。
- L2 的迁移尚未发布，按控制计划 D10 可整份重写，不存在需要保住的库。

## Interfaces and Dependencies

**本轮改动的公共接口**

```text
packages/capabilities/src/storage.ts
  ProviderBindingRecord        # 形状不变，语义收敛为「某工作区挂载某连接」的视图
  putProviderBinding(record)   # 新增语义：同一 id 即同一连接；换 implementation_key 必须被拒绝
  listMemberships(...)         # 新增排序承诺
packages/storage/sqlite/migrations/002_identity_membership.sql
  provider_binding(id, implementation_key)          # 连接锚点
  workspace_binding(workspace_id, binding_id, ...)  # 工作区挂载
```

**依赖的仓库设置与外部条件**

- Node 26（`node:sqlite`），无第三方运行时依赖。
- `gh` CLI 已登录（`repo`、`project` 作用域）；分支保护要求线性历史与 `PR Fast Gate`。
- 栈内 L3–L6 的 base 链：L3 #157 → L4 #167 → L5 #170 → L6 #175。

**依赖的既有决策**

- `docs/architecture/gate-e1-ruling.md` §4 的 R1–R8；`docs/adr/ADR-0001`、`ADR-0004`、`ADR-0005`。
- `AGENTS.md` §1.1 不变量 1 / 2 / 6；§6 的 PR 闭环与规模；§7 的人类批准边界。

## Outcomes & Retrospective

**21 条意见逐条处置：全部属实**。第一轮的对抗验证把两条判成「过严」，其中一条（#121-6 的「压缩删掉了上一轮第 8 条的修复」）在按评审给出的 `7da7e7d` / `e782464` 原文比对后**被推翻**——那条修复确实被删掉了，已按原意补回；另一条（#122-10 的 `listMemberships` 顺序）在重读评审原文后也不再算过严：评审给的是「约定顺序**或**声明无序并让套件按集合比较」两个方向，指认的是**契约缺口**而不是实现缺陷。最终结论：**21 条全部属实，无需反驳**；只有三处措辞需要精确化（D6 的原文、「两个成因各有独立观测」的范围、「守卫 4 种逃逸」的拆分），已写在对应 thread 里。

**逐条修复与证据**：见两个 PR 的 21 条 thread 回复；每条都给了改动位置、判定命令与真实输出。

**验证证据**（各层 head 以 D2 的回读命令为准；以下是修复时点的观察值）：

| 层 | head | 测试 | tsc | size（代码 / 文档） |
|---|---|---|---|---|
| L1 #121 | `d26cfe7` | 契约 452 / 452 | — | 251 / 1000、1486 / 1500 |
| L2 #122 | `4d86a96` | 520 / 520、mvp0 7 / 7 | 0 | 999 / 1000、1016 / 1500 |
| L3 #157 | `8f11e38` | 530 / 530、mvp0 7 / 7 | 0 | 439 / 1000、186 / 1500 |

**变异实验**：L1 的证据守卫六组（改名 / `##` / `####` / 删节 / 加节 / 未登记新文档）全部 RED、还原后 GREEN；L2 的 DDL 七组（身份键加回 `workspace_id`、去掉 project 分量、去掉 planning 索引、去掉 `domain` 的 CHECK、去掉 `is_default` 蕴含 `enabled`、删约束级出处、加凭据列）与替身二十组全部红色、还原后 GREEN。

**一处结构性发现（留给人类伙伴）**：L2 的契约断言一旦放进 `tests/contract/suites/storage.js`，L4 切分套件时要把它们搬进分组文件，同一批行在 L4 的 diff 里算两次（删 + 增）。按 L4 当时的 992 / 1000 预算，这会直接把 L4 顶到约 1290 行。因此把 L2 的新断言单独成文（`suites/storage-identity-membership.js`，分地基组与同步组），让 L4 及以上**原样继承**。这不是绕过预算，而是把「一个端口面一个文件」的组织方式贯彻到底；但它暴露了一条更一般的规则：**栈内任何一层的契约套件扩容，都会按 2 倍记到做套件切分的那一层账上**——下次切分前应先确认下游各层的预算。

**遗留与技术债**（本仓库没有独立的债务追踪文件，债务落在各层计划的 `遗留问题与技术债务` 段，见 `PLANS.md` §3 的强制章节）：

- L4–L6 的级联结果与各层复跑摘要见 `Progress`（三层各自的用例数、`size` 与退出码）。
- 评审记录里的 `锁定事实` 保持评审时点的快照，未改成响应后的 head——它们是「评审锁定的事实」，不是「当前 head」；响应后的 head 以各 PR 的回读为准。
- `docs/README.md` 的 Completed 表每行比两列表头多一个单元格，是既有格式缺陷，不在本轮改动面内。
- **栈内契约套件扩容的 2 倍记账效应**（见上）没有机械守卫：做套件切分的层要先自己确认下游预算，靠人记得。若再出现一次，值得写一条「切分层必须申报搬运行数」的检查。

## Bottom Change Note

- 2026-09-24：首次创建。原因：PR #121 / #122 的 2026-09-24 评审留下 21 条未 resolve 的 inline 意见；独立复现后收敛成 6 个根因，本计划按根因组织修复、验证与级联。
