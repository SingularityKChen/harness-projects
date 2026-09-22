# Gate E1 · 三类内容身份 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：在真实平台上建立一个一次性沙箱，对"一个 project membership 可以指向三种内容"做三组观测实验，并把观测、映射与判定写成可复现记录。本批次同时固定后续三个批次复用的**记录模板**与**沙箱定义**。
> 上游输入：issue #22（本批次）、issue #4（父门禁与六条行为）、`docs/architecture/README.md`（数据模型与外部身份注册表的当前依据）、`docs/architecture/release-gates.md` §2 第 1 条、`AGENTS.md` §1.1 第 6 条与 §1.2

## Purpose / Big Picture

完成后，下面这句话有真实平台观测支撑，而不是设计文档里的断言：

> 一个 project membership 指向 issue、draft 或 change request 三种内容之一；三种内容映射到内部身份时**成员关系身份与内容身份分离**，且 change request 不产生第二个工作项。

判断成功的最小证据：

1. `docs/architecture/gate-e1-sandbox.md` 里的步骤能让一个没有本次会话上下文的人重建等价沙箱（同样的仓库、两个 project、三类成员关系）；
2. `docs/architecture/gate-e1-content-identities.md` 的三条实验记录各自给出请求、观测到的外部 id 与时间戳、本地应有的行、意外行为、决策影响与判定；
3. 三条记录里 change-request 一条的"本地应有行"中工作项计数为 **2 而不是 3**（issue 一条、draft 一条；change request 解析为变更请求，不新增工作项）；
4. 记录中不出现任何凭据、token、本机绝对路径或本机用户名。

本批次不产生 `packages/` 下的实现代码：spike 的产出是证据。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 沙箱 | 一次性的私有仓库 + 两个 user-owned Project v2，仅用于本门禁的观测；不接触任何生产项目 |
| 成员关系（membership） | project 里的一行：`ProjectV2Item`。它有独立于内容的 id 与位置语义（字段值挂在它上面） |
| 内容（content） | 成员关系指向的对象：`Issue` / `ProjectV2DraftIssue` / `PullRequest` 之一 |
| 内容身份（content identity） | 内部模型里"这是同一个底层对象"的判据，落在外部身份注册表上 |
| 记录模板 | 每条实验统一填写的字段集合，由本批次固定，E1-2 / E1-3 / E1-4 逐字复用 |
| 本地应有行 | 若此刻把观测落进本地模型，应当写入哪些表、哪些键、哪些计数；它是"映射"的判定载体，不是实现 |

### 当前事实（本批次开始时）

- `packages/domain` 已冻结标识、身份、关系与状态语义（PR #81）；`packages/capabilities` 已冻结五域契约（PR #84）。两者都**没有**承诺任何真实平台的具体 id 形状。
- 仓库内**没有**任何一条对真实平台的身份观测记录；`tests/` 下全部用例在无凭据、无网络下运行（`tests/README.md` §3）。
- Gate E1 未通过，因此本地数据模型 v1 未冻结（`AGENTS.md` §1.2）；`packages/storage/sqlite` 只有迁移运行器，没有业务表。
- 本批次是 #4 的第一个子 issue，并且按 #22 的要求**同时承载后续实验复用的沙箱与记录模板**。

### 栈内位置

本批次是一个四层栈的底层，栈序即依赖序：

| 层 | issue | 分支 | 依赖理由 |
|---|---|---|---|
| E1-1（本批次） | #22 | `test/e1-content-identities` | 建立沙箱与记录模板 |
| E1-2 | #23 | `test/e1-membership-and-draft` | 复用 E1-1 的沙箱与模板 |
| E1-3 | #24 | `test/e1-write-and-events` | 复用 E1-1 的沙箱与模板 |
| E1-4 | #25 | `test/e1-ruling` | 读 E1-1/E1-2/E1-3 三份记录 |

E1-2 / E1-3 是同一个沙箱上的**不同夹具**，不是同一条链的后续步骤：E1-1 建立的沙箱里，三个内容夹具（issue / draft / change request）归 E1-1 使用，E1-2 另建它自己的共享 issue 与待转换 draft，E1-3 另建它自己的可写条目。夹具互不重叠，因此三个批次可以并行观测而同一条记录不互相改写。

### 上游依据

- issue #22 的验收条件（本计划 `Validation and Acceptance` 逐条对应）。
- issue #4 的六条行为中本批次负责第 1、2 条（一个外部对象两个工作区一条外部身份；change request 成员关系不产生第二个工作项）。
- `docs/architecture/README.md`：外部身份注册表与工作区级投影是当前的数据模型依据。
- `docs/development/publication.md`：本仓库是公开的，分支、PR 描述与提交信息都是发布面。

## Design / Spec

### D1 证据必须是仓库内容，不是会话记录

观测只写在会话里，等于没有证据：下一个人无法复核，E1-4 的裁决也无从引用。因此每条实验落成仓库内的记录文件，字段由 D4 的模板固定。判定一个批次是否交付，看的是记录文件，不是"跑过了"。

### D2 沙箱是一次性的、私有的、可重建的

沙箱是一个**私有**仓库加两个 user-owned Project v2，只放夹具，不放任何真实项目数据。记录里给出重建步骤与拆除步骤：一个读完记录的人能建出等价沙箱，也能把它删干净。不用生产项目是硬约束（issue #22 Scope），因为观测会写入字段、转换 draft，这些副作用不允许落在真实工作上。

### D3 观测真实平台，不观测我们的假设

三条实验各自调用真实 API 并把**响应原文的关键字段**记下来。禁止用"平台应该会返回 X"补齐缺失字段；字段缺失本身就是观测结果，必须如实记录。这正是本门禁存在的理由——`AGENTS.md` §1.2 要求 E1 通过前不冻结模型，就是为了避免把假设当事实冻进 v1。

### D4 记录模板固定九个字段

每条实验记录按下列字段填写，顺序固定，E1-2 / E1-3 / E1-4 逐字复用同一模板：

| # | 字段 | 内容要求 |
|---|---|---|
| 1 | 实验编号与目的 | 一句话说明这条实验判定哪条行为 |
| 2 | 夹具 | 用到的外部对象及其 id；沙箱定义文件里的引用名 |
| 3 | 请求 | 可直接复制的命令；参数用变量占位，不写死 token |
| 4 | 观测 | 外部 id、时间戳、字段值；只写实际返回的内容 |
| 5 | 本地应有行 | 表名 + 键 + 计数；说明为什么是这些行 |
| 6 | 意外行为 | 与预期不符之处；没有就写"无" |
| 7 | 决策影响 | 它改变或不改变哪条设计决定 |
| 8 | 判定 | pass / fail / inconclusive + 依据 |
| 9 | 复现 | 从沙箱定义出发重跑本实验的命令序列 |

### D5 内容身份的判据是"跨 API 一致的那个 id"

同一个底层对象在不同 API 上可能给出不同 id（REST 的 issues 端点把 change request 也当 issue 返回）。本批次必须把这一点**观测出来**而不是推断出来：对同一个 change request，同时取 GraphQL 的 `PullRequest.id`、GraphQL 的 `Issue.id`（若可达）与 REST 的 `issues/{n}.id`，记录三者是否相等。结论决定外部身份注册表的键是"平台 + 对象种类 + id"还是"平台 + 单一规范 id"。

### D6 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 用离线替身模拟平台行为 | 回答的是"我的模型是否与我的模型一致"；E1 要回答的是"模型是否与平台一致" |
| 只记录顺利路径 | 身份模型的失败点几乎都在异常形状上（PR 的 id 与 issue 的 id 不同、draft 没有仓库）；只记顺利路径等于只验证已知 |
| 在真实工作项目上做实验 | issue #22 Scope 明确禁止；字段写入与 draft 转换是不可忽略的副作用 |
| 把观测写进 PR 描述 | PR 描述不是仓库内容，不随 `git checkout` 出现，也不受 `docs/` 的规范约束（`docs/project-management/merge-queue.md` §1 记录过同类失败） |
| 用截图当证据 | 不可检索、不可 diff、无法机械核对字段缺失 |

### D7 记录里的标识符处理

沙箱的 owner 与本仓库 owner 是同一个公开账号，仓库 URL 已经公开了它，因此记录里直接写账号名不新增暴露面；**本机**路径、本机用户名、hostname、token 一律不出现，命令统一用 `$E1_OWNER` / `$E1_REPO` / `$E1_PROJECT_A` 这类变量，并在沙箱定义文件里给出一次赋值。判定方式是机械扫描加人工五类目核对（`docs/development/publication.md`）。

### D8 第一轮修的是"规则缺失"，第二轮暴露的是"规则没有强制点"（2026-09-22）

第二轮评审在同一 head 上给出 9 条意见，逐条核对**全部属实**。按"症状 → 直接原因 → 根机制"归并，得到三个根机制，而不是九个独立笔误：

| 根机制 | 命中的意见 | 直接原因 |
|---|---|---|
| **R1 内容断言没有强制点** | 数字与实测不符（P1）、重建判据必然为假、声明的文件集合与 diff 不符、"五组命令没有判别力"这条元意见 | 数字/集合/判据都是**手工推导后写成散文**，而同文件里已有可推出它们的原始观测；没有任何检查能在不一致时失败 |
| **R2 易失的本地状态仍被写成值** | 凭据 scope 清单（两处） | 第一轮把"易失状态写成回读命令"写进 `PLANS.md`，但只对**新增内容**生效，没有对存量回扫一次 |
| **R3 声明强于实际** | 分支前缀不在允许集合、悬空引用 #108 的交付物、"唯一赋值处"的措辞 | 声明缺少"适用范围 / 交付方"限定词 |

**主要矛盾是 R1**：第一轮把规则写进 `PLANS.md` 只是**声明**；强制点在能失败的检查里。`docs/architecture/release-gates.md` §2.2 已经吃过同一个教训——"空层的 exit 0 不是证据"。本批次因此不止改数字，还要补一个**能失败的断言**（Batch 2 第 3 项）。

**R1 的具体形态值得单独记下来**：`规划字段值` 这一行的"行数"列在三处实验里含义不同——实验 1 填的是**用户可写**的规划字段数（1），实验 2 填的是**原始** `fieldValues` 数（2）。汇总表按"用户可写"手算 alpha / beta / gamma 时沿用了实验 2 的原始数，于是 beta 得 0，而它实际有 1 个（`Status` = Todo）。**歧义来自记录模板没有定义这一列的含义**，不是某一次算错。

### D9 分支前缀：规则列表漏了 `test`

`AGENTS.md` §6 与 `docs/development/repository-rules.md` 列出的前缀是 `feature/` / `fix/` / `docs/` / `chore/` / `project-management/`。本栈四个分支用 `test/`，不在其中。**改规则而不是改分支名**，理由：仓库的 kind 分类里 `test` 是合法取值（`kind:test` 标签、`test` 提交类型），而这五个前缀里**没有任何一个**能正确表达一个 `kind:test` 的分支；PR #87（`test/mvp0-chain-assertion`，已合并）已经用过该前缀，规则在本次之前就与实际不符。改名的代价不对等：四个 PR 的 head 分支改名会动到 17 条评审线程的锚定对象，而规则列表补一个词是零风险。两个文件同步补。

## Global Constraints

- 本批次只改文档。**本清单是本批次文件集合的唯一权威**（`PLANS.md` §4「一个事实只写一处」）；其它小节要提它时写"见 `Global Constraints`"，不复述：
  - `docs/exec-plan/completed/2026-09-21-gate-e1-content-identities.md`（本计划；全部验收通过后按 `PLANS.md` §2 归档，文件名不变）
  - `docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md`（两份记录）
  - `docs/architecture/README.md`、`docs/README.md`（索引；`docs/README.md` 是 **+1/−1**：加本计划一行、同时删掉 Active 表里指向 `exec-plan/completed/2026-09-21-policy-check-pr-number.md` 的重复行——该行在 Completed 表已有，见第二轮评审）
  - `docs/project-management/merge-queue.md`（§4.3 / §4.4 本轮队列与关闭引用语义）
  - `PLANS.md`（§4 增补四条活文档一致性规则）。**为什么在本批次**：评审指出本计划的范围声明自相矛盾（同一集合写了 7 处，其中 5 处说"不改这两个文件"而 diff 改了它）；机械调查显示同一缺陷在本轮六份计划里命中五份、证据缺执行上下文命中六份，所以按根因修在产生它的那一层，而不是只把本计划改对。
  - `tests/contract/e1-evidence-consistency.test.js`（新建）。**为什么在本批次**：第二轮评审的元意见指出，五组验证命令只查结构计数、对内容没有判别力，而这一轮已经有一个数字错误（`规划字段值` 的 beta 格）从它们眼皮下过去。D8 的 R1 说明"规则写进 `PLANS.md` 只是声明，强制点在能失败的检查里"，所以本批次补这个断言。
  - `AGENTS.md`（§6 分支前缀列表补 `test/`）、`docs/development/repository-rules.md`（同一列表）。**为什么在本批次**：见 D9——规则列表漏了 `test`，而本栈四个分支正是 `test/`；补词零风险，改名会动到 17 条评审线程的锚定对象。
- **~~不新增任何 `packages/` 或 `tests/` 下的代码~~**（2026-09-22 修正）：spike 的产出是证据，**不新增 `packages/` 下的实现代码**；但"证据本身需要一条能失败的断言"（D8 的 R1），因此允许新增 `tests/contract/e1-evidence-consistency.test.js`——它只读仓库内的文档，不触网、不需要凭据。
- 沙箱必须是私有的、一次性的；不得在 `SingularityKChen/harness-projects` 自身或其 Projects 看板上创建任何夹具。
- 记录中不得出现凭据、token、本机绝对路径、本机用户名或 hostname。
- 文档改动 ≤ 1500 行（按 `node scripts/rule-checks.mjs size <base>` 度量）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 沙箱与记录模板（本批次，issue #22）

**最小闭环**：沙箱存在且可重建；记录模板固定；三条内容身份实验各有记录与判定。
**涉及文件**：`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md`（本批次的主文件；完整集合见 `Global Constraints`）

- [x] 建立私有沙箱：一个仓库、两个 Project v2、三类内容夹具（issue / draft / change request），记录每个对象的 id 与创建时间
- [x] 固定九字段记录模板（D4）并写进沙箱定义文件
- [x] 实验 1：issue-backed membership —— 记录 `ProjectV2Item.id`、内容 id、编号、仓库、时间戳
- [x] 实验 2：draft-backed membership —— 记录 `ProjectV2Item.id`、draft id、"没有仓库"这一形态
- [x] 实验 3：change-request-backed membership —— 记录成员关系 id、`PullRequest.id`、REST `issues/{n}.id`，并判定 D5
- [x] 每条实验给出"本地应有行"，其中工作项计数必须为 2（issue + draft）
- [x] 拆除步骤写进沙箱定义文件（记录如何删干净）
- [x] 把本轮队列写回 `docs/project-management/merge-queue.md` §4：六个 PR 的位置、依赖、已知冲突点，以及**栈内 PR 的关闭引用要等 retarget** 这条实测语义
- [x] 更新 `docs/architecture/README.md` 的主题索引与 `docs/README.md` 的 ExecPlan 索引（两行索引随本批次提交；集合见 `Global Constraints`）

**验证**：

```bash
# 1) 记录齐全：三条实验各有九个字段
grep -c '^### 实验 ' docs/architecture/gate-e1-content-identities.md   # 期望：3
# 2) 沙箱定义给出重建与拆除两条路径
grep -c '^## ' docs/architecture/gate-e1-sandbox.md                     # 期望：≥ 4
# 3) 发布面机械扫描
node scripts/rule-checks.mjs disclosure origin/main                     # 期望：exit 0
# 4) 体量
node scripts/rule-checks.mjs size origin/main                           # 期望：文档 ≤ 1500，exit 0
# 5) 文档链接不悬空
git diff --check origin/main...HEAD                                     # 期望：无输出
```

**回滚**：`git revert` 本批次提交；仓库回到"没有沙箱、没有身份观测"的上一版。沙箱本身不随仓库回滚，拆除命令在沙箱定义文件里，由人类伙伴决定何时执行。

### Batch 2 · 第二轮评审：内容纠正、发布面与强制点（2026-09-22）

**最小闭环**：9 条意见逐条落地，且 R1（内容断言没有强制点）有一条能失败的断言把它关住，而不是只把这一轮的数字改对。

**涉及文件**：见 `Global Constraints`（本批次新增 `tests/contract/e1-evidence-consistency.test.js`、`AGENTS.md`、`docs/development/repository-rules.md`）。

- [x] **R1 · 内容纠正**（3 条）
  - `规划字段值` 的"行数"列在记录模板里定义一次：**只计用户可写的规划字段值**，内容派生的系统字段值（`Repository`）与内容字段（`Title`）不计入；三处实验按同一定义填写；汇总表按同一定义重算为 **1 / 1 / 1**（原值 `1 / 0 / 1` 是沿用了实验 2 的原始 `fieldValues` 数）
  - 沙箱 §4.1 拆成两段：(a) **当前状态回读**（允许 id 字面量，标注观察时刻与 head）；(b) **重建等价判据**（只写形状：`totalCount == 7`、三种 `type` 齐全、Project B `totalCount == 1`，不含任何 node id 字面量、不依赖 E1-2 转换后的状态）
  - `Global Constraints` 记录 `docs/README.md` 的 +1/−1
- [x] **R2 · 发布面**（2 条）
  - 沙箱定义里的 `gh` 凭据 scope 清单改为**需求 + 回读命令**（`gh auth status`，期望：刷新后含 `delete_repo`），不再写本机凭据的 scope 值
  - ExecPlan 里那份重复副本改为引用沙箱定义 §5，不复述
- [x] **R3 · 声明**（3 条）
  - 跨 PR 引用标注交付方（`docs/architecture/gate-e1-ruling.md`（#108 交付））
  - "唯一赋值处"的措辞限定为**变量赋值**；正文里的 id 字面量属观测值，不构成第二赋值处
  - 分支前缀列表补 `test/`（`AGENTS.md` §6 与 `docs/development/repository-rules.md`），理由见 D9
- [x] **R1 · 强制点**（1 条，本条是根因修复）
  - 新增 `tests/contract/e1-evidence-consistency.test.js`：离线读三份 E1 文档，断言
    (i) 记录文件里出现的每个 id 字面量都在沙箱定义的清单里，且同一个 id 不被绑定到两个不同变量；
    (ii) 三处实验的 `规划字段值` 行使用同一个定义，且汇总表的三个数与它们逐一相等；
    (iii) 文档里以"`N` 个 `fieldValues`（…枚举…）"形式出现的原始计数与枚举项数相等。
  - **判别性验证**：把 beta 那一格改回 `0`（复现本轮 P1），(ii) 必须变红；还原后复跑全绿

**验证**：

```bash
# 在检出本批次分支 test/e1-content-identities 的工作树根目录运行
node --test tests/contract/e1-evidence-consistency.test.js   # 期望：全绿；注入 beta=0 后必须红
node --test tests/contract tests/integration tests/e2e        # 期望：全绿（新增文件不破坏既有套件）
node scripts/rule-checks.mjs disclosure origin/main           # 期望：exit 0
node scripts/rule-checks.mjs size origin/main                 # 期望：文档 ≤ 1500、代码 ≤ 1000，exit 0
git diff --check origin/main...HEAD                           # 期望：无输出
```

**回滚**：`git revert` 本批次提交；文档回到第二轮评审前的版本，测试文件整体删除。回滚后 R1 恢复为"无强制点"，这是已知的、被记录的残余状态。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 沙箱可由无上下文的人重建 | `docs/architecture/gate-e1-sandbox.md` 的重建步骤逐条可复制，且每条给出期望输出 | 满足：创建步骤给出全部对象；**重建判据是 §4.1(b) 的形状判据**（Project A `totalCount == 7` 且三种 `type` 齐全、Project B `totalCount == 1`），不含 id 字面量、也不依赖 E1-2 转换后的状态；§4.1(a) 是标注观察时刻（2026-09-21 07:18:02Z）的快照，**不是判据**（第三轮评审订正：本行原先写「判据是当前事实回读（…转换条目当前为 `ISSUE`）」，把沙箱定义明确排除的快照写回了验收表，且该半句在重建出的沙箱上必假）；可执行部分经一次性探针实测（§4.2）。创建步骤本身未逐条重跑，理由与替代证据见 Surprises 第 8 条；正文判据需人工核对，五组结构命令无法判别其内容 |
| 2 | issue-backed membership 给出两个不同内部 id | 实验 1 的"本地应有行"：一条 membership + 一个工作项，规划字段在 membership 上、内容字段在工作项上 | 满足：成员关系 `PVTI_lAHOAY1ahM4BkJ9rzg75k2w`、内容 `I_kwDOUjWAl88AAAABST4WDQ`，两侧各有独立时间戳；3 个 `fieldValues` 全在 item 上，其中只有 `Status` 是用户可写规划字段 |
| 3 | change-request 不产生第二个工作项 | 实验 3 的"本地应有行"工作项计数为 2（issue + draft），change request 解析为变更请求 | 满足：工作项 2、变更请求 1；Project A 全部 7 个条目映射后是工作项 6 + 变更请求 1；此计数及推论需人工核对，五组结构命令不具判别力 |
| 4 | draft 的"没有仓库"被记录而不是被假设 | 实验 2 明确写出 draft 无 `repository`、无 `number`，并记录该形态如何影响本地键 | 满足：给出 `undefinedField` 报错原文与 `DraftIssue` 字段全集；结论是键不能以 `(repository, number)` 为前提 |
| 5 | 每条实验九字段齐全 | 三节实验记录逐字段核对；缺失即不通过 | 满足：`grep -c '^### 实验 '` = 3，逐条核对九个字段均有内容 |
| 6 | 记录不含凭据与本机信息 | `node scripts/rule-checks.mjs disclosure origin/main` exit 0，且人工五类目核对无命中 | 满足：机械扫描 exit 0（输出见 Progress）；人工核对五类目：凭据无、本机路径与身份无（命令里只有 `$E1_*` 变量与 `<sandbox-clone>` 占位符）、账号个人信息只有仓库 URL 已公开的 owner 名、内部系统无、保密字样无 |
| 7 | 跨 API 的 id 形状被观测而不是推断 | 实验 3 记录 `PullRequest.id` 与 REST `issues/{n}.id` 的实际值并给出 D5 判定 | 满足：三个 id 实测互不相等，判定为「平台 + 对象种类 + id」，依据与反例见记录文件 §3 |
| 8 | （第二轮新增）**证据内容的一致性有可失败的断言**，不再只靠人眼 | `node --test tests/contract/e1-evidence-consistency.test.js` 全绿；注入一个内容错误后必须变红 | 满足：3 pass / 0 fail；注入"汇总表 beta 格 = 0"后第 2 条断言变红，还原后逐字节相同。**边界如实记录**：它强制的是文档**内部**一致，不强制与平台一致——把某处数字与它的枚举一起改成同一个错值仍会通过；与平台的一致性只能靠重跑 API，见记录文件 §2 的观测原文 |

## Progress

- [x] (2026-09-21) 建立沙箱并记录对象清单 —— 沙箱在计划批准前已由编排者建好；本批次读出全部 id 并写成 `docs/architecture/gate-e1-sandbox.md` §2
- [x] (2026-09-21) 固定九字段记录模板 —— 沙箱定义 §6；三条实验逐字段填写
- [x] (2026-09-21) 实验 1 · issue-backed membership —— 记录文件 §2，判定 pass
- [x] (2026-09-21) 实验 2 · draft-backed membership —— 记录文件 §3，判定 pass
- [x] (2026-09-21) 实验 3 · change-request-backed membership —— 记录文件 §4，判定 pass；工作项计数 2
- [x] (2026-09-21) 对抗验收 P2 修订 —— 按真实 API 回读修正跨 project 内容身份证据、规划字段计数、E1-2 转换后的重建判据与队列文件状态计数；并记录五条原验证命令对正文变化不敏感，需人工逐条核对
- [x] (2026-09-21) 队列记录写回 `docs/project-management/merge-queue.md` §4.3 / §4.4
- [x] (2026-09-21) 发布面自查 —— `disclosure` exit 0，并人工过五类目（见 `Validation and Acceptance` 第 6 项）
- [x] **索引更新已随本批次提交**：`docs/README.md` 的 Active 表与 `docs/architecture/README.md` 的主题索引各加一行（集合见 `Global Constraints`）
- [x] **~~本 ExecPlan 留在 `docs/exec-plan/active/`~~ Superseded（2026-09-22）：全部验收通过，已按 `PLANS.md` §2 移入 `docs/exec-plan/completed/`（文件名不变），`docs/README.md` 的索引行随之从 Active 表移到 Completed 表。**
- [x] (2026-09-22) **第二轮评审的 9 条意见按 D8 的三个根机制落地**：R1 内容纠正（规划字段计数 1 / 1 / 1、重建判据拆成快照与形状判据、`docs/README.md` 的 +1/−1 入册）、R2 发布面（凭据 scope 清单改为需求 + `gh auth status` 回读，两处副本收归一处）、R3 声明（跨 PR 引用标注交付方、"唯一赋值处"限定为变量赋值、分支前缀补 `test/`）
- [x] (2026-09-22) **R1 的强制点已建立**：新增 `tests/contract/e1-evidence-consistency.test.js`（3 条断言，离线）。注入实验：把汇总表 beta 格改回 `0` → 第 2 条断言变红；还原后逐字节相同、复跑全绿。全量离线套件 382 pass / 0 fail
- [x] (2026-09-22) **第三轮评审的 6 条意见落地**（1 条 P2、5 条 P3，逐条核对全部属实）：Validation 第 1 项改引 §4.1(b) 的形状判据（原先把沙箱定义明确排除的快照写回验收表，并带回「转换条目当前为 `ISSUE`」这半句）；Batch 2 的四个复选框勾上；本文件 `:246` 的体量期望改为「代码 ≤ 1000」；契约测试补一条下限断言，使其三条 skip 路径全部 fail closed
- [x] (2026-09-22) **归档**：全部验收通过，按 `PLANS.md` §2 移入 `docs/exec-plan/completed/`（文件名不变），`docs/README.md` 索引行随之从 Active 表移到 Completed 表

### 验证实测输出（2026-09-21）

下面五组命令在 `1c2b5d4`（两份架构文档与队列记录已提交）上实跑，输出为原文；下面的输出块是**那次快照**，基线 `origin/main @ eba9c7412e8f` 早已不是当前 `main`。体量随本文件的每次编辑变化，**因此不在这里写死行数**——要当前值就跑 `node scripts/rule-checks.mjs size origin/main`（期望：代码 ≤ 1000、文档 ≤ 1500，exit 0）。注意：这五组命令只检查结构计数、发布面扫描、体量与空白，**对交付物的实质内容没有判别力**；例如把"工作项 2 个"改成 3 个，或把某节正文替换成"待补充"，它们仍会照常通过。因此 Validation 第 2–5 项只能通过人工逐条核对正文、表格、实测 id 与每条推论，不能用这五组命令替代内容验收。

执行上下文：以下命令都在**仓库根**（本 PR 的 worktree 根）运行；`origin/main` 与相对路径都相对该目录解析。

```text
# 1) 三条实验的九字段记录齐全
$ grep -c '^### 实验 ' docs/architecture/gate-e1-content-identities.md
3

# 2) 沙箱定义给出重建与拆除两条路径
$ grep -c '^## ' docs/architecture/gate-e1-sandbox.md
8

# 3) 发布面机械扫描（基线 origin/main @ eba9c7412e8f）
$ node scripts/rule-checks.mjs disclosure origin/main
基线：origin/main @ eba9c7412e8f（扫描范围 origin/main...HEAD）
机械扫描通过，覆盖范围：对 base 的新增行、范围内每个提交单独引入的新增行、
每个提交信息、PR 描述（经 PR_BODY 传入时）——以上均未命中任何已知模式。
exit=0

# 4) 体量（同一基线）
$ node scripts/rule-checks.mjs size origin/main
基线：origin/main @ eba9c7412e8f（判定范围 origin/main...HEAD）
代码：0 / 1000 行（增删之和）
文档：951 / 1500 行（增删之和）
exit=0

# 5) 空白与冲突标记
$ git diff --check origin/main...HEAD
（无输出，exit=0）
```

## Surprises & Discoveries

观测期间与预期不符、或推翻本计划假设的事实。每条都附取得它的命令或输出原文。

1. **同一个 change request 在 REST 的两个面上有两个数字 id**。`pulls/5.id = 4588791734`，`issues/5.id = 5523780322`；唯一跨面一致的是 node id（`PR_kwDOUjWAl88AAAABEYNntg`，同时是两个端点的 `node_id`，也是 GraphQL `PullRequest.id`）。计划 D5 原本只假设"不同 API 可能给出不同 id"，实测确认了它，并且给出了具体形状——这直接决定注册表的键不能只写"平台 + id"。

2. **draft 的"没有仓库、没有编号"不是返回 `null`，而是类型上不存在这两个字段**。向 `DraftIssue` 要 `repository` / `number` 得到 `undefinedField` 报错（exit 1），introspection 的字段全集里也没有它们。计划原本的措辞是"记录 draft 没有仓库这一形态"，实测把"没有"精确成了"schema 层面不存在"——两者的本地键影响不同：前者可以写 `null` 占位，后者要求键本身允许缺失这两个分量。

3. **project 条目连接存在读后写延迟**。一次性探针里 `gh project item-add` 返回成功后，紧随其后的 `items` 查询只看到 `totalCount: 1`，约 3 秒后重查才看到 `totalCount: 2`。这条不在任何计划假设里，是重建判据的直接风险：按"命令返回即生效"写判据会得到假阴性。

4. **GraphQL 的 issue 面与 REST 的 issues 面对同一编号给出相反答案**。REST `issues/5` 返回了对象，GraphQL `repository.issue(number: 5)` 返回 `null` 并报 `NOT_FOUND`。只看 `data` 的调用方会把 change request 的编号读成"不存在"。

5. **条目上的 `fieldValues` 集合随内容种类变化**。issue / change request 条目各 3 个（含一个 `ProjectV2ItemFieldRepositoryValue`），draft 条目 2 个——draft 没有仓库可指。预期是"字段值只由用户写入决定"，实测还有内容种类派生的系统字段值。

6. **`gh project field-create` 不能建 iteration 字段**。`--data-type` 只有 `TEXT|SINGLE_SELECT|DATE|NUMBER`，`ITERATION` 必须走 GraphQL `createProjectV2Field`。沙箱里已有的 `E1 Iteration` 因此只能这样重建，探针实测了这条路径。

7. **~~本轮四层 E1 栈不是 GitHub 的 stack 分组。~~ Superseded by `docs/project-management/merge-queue.md` §4.4（2026-09-21）。**
   原文：在 #105 的分支上 `gh stack view` 返回 `current branch "test/e1-content-identities" is not part of a stack`（exit 2），与 §4.2 记录的上一轮"PR 被归入 stack 后 base 改不动"不同，因此人工 `gh pr edit <n> --base main` 可能不被 stack 规则挡住。
   **为什么被推翻**：同一时间窗内三个**服务端**症状同时出现——关闭引用从空变齐、`ci.yml` 的 `Verify` / `PR Fast Gate` 开始在栈内 PR 上运行、`rule-checks` 的 `PR size` 改按 `main` 度量——指向 GitHub 服务端把这条链当成了 native stack。`gh stack` 扩展自己的登记里没有这条栈，**不能**用来推断服务端行为。
   **原证据的可复现性**：`gh stack view` 不接受分支参数，只读当前 checkout，因此记录必须带工作目录。实测（2026-09-22，在仓库根运行）：

   ```bash
   $ (cd .worktrees/w3-e1-1 && gh stack view)     # 该 worktree 检出 test/e1-content-identities
   ✗ current branch "test/e1-content-identities" is not part of a stack
   $ gh stack view definitely-not-a-real-branch-xyz   # 参数被静默忽略，仍报当前分支
   ✗ current branch "main" is not part of a stack
   ```

   评审指出原记录"这行输出不可能由这条命令产生"——**这句过严**：在对应 worktree 里跑确实能产生它。真正的问题是原记录没写执行上下文，所以按记录复现不出来。判据是"记录能否让第三方复现出同一结果"，不是"命令签名是否接受参数"。

8. **没有做到、如实记录的三件事**：
   - 沙箱**创建步骤没有逐条重跑**（对象建在本批次开工之前）。替代证据是：命令形式用 `gh <cmd> --help` 逐条核对，可执行的部分（字段创建、条目创建、条目读取、项目删除）用一个一次性探针项目实测，跑完立即删除。不重跑的理由是重跑会污染正在被 E1-2 / E1-3 观测的共享沙箱。
   - **仓库删除未执行**：它需要 `delete_repo` scope，当前凭据没有，所以 `gh repo delete` 会失败。需求、刷新步骤与回读命令（`gh auth status`，期望刷新后输出含 `delete_repo`）写在沙箱定义 §5 与 §8——**本计划不复述凭据的 scope 值**（那是易失的本地状态，`PLANS.md` §4）。执行时机由人类伙伴决定。
   - **`ProjectV2ItemType.REDACTED` 未观测**：枚举里有这个取值，但删除内容会破坏正在被观测的夹具，因此没有触发它。已写进记录文件 §4 的未验证假设清单，不当作已知形态。

9. **~~计划里"索引更新"这一项按硬约束拆掉了。~~ Superseded by `Global Constraints` 与 `Progress`（2026-09-22）。**
   原文：`docs/README.md` 与 `docs/architecture/README.md` 本批次不改（见 Decision Log），因此 Progress 里那一项保持未勾选，并写明延后到栈级联。
   **为什么被推翻**：实际 diff 改了这两个文件——索引行随本批次提交。原文与 `Global Constraints` 直接矛盾，且它预判的冲突确实发生了（`main` 在同一个插入点加了 `2026-09-21-rule-checks-api-base` 一行，本 PR 又加一行，于是 rebase 时在 `docs/README.md` 冲突）。现在文件集合只有 `Global Constraints` 一处声明。

## Decision Log

- **Decision**：三条实验共用一个沙箱，但夹具互不重叠，且沙箱定义与模板随本批次（栈底）交付。
  **Rationale**：E1-2 / E1-3 需要同一个平台上的对象才能比较；但夹具重叠会让"这条记录被谁改过"无法定位。栈底交付定义与模板，使上层三批可以并行观测而不互相改写。
  **Date/Author**：2026-09-21 / agent

- **Decision**：spike 不产生 `packages/` 代码。
  **Rationale**：issue #22 Scope 明确"任何 `packages/` 下的生产代码都不在范围内：这是 spike，产出是证据"。把观测顺手写成实现，会让"模型是否成立"这个问题被实现细节绑架，也会让 E1-4 的裁决失去独立性。
  **Date/Author**：2026-09-21 / agent

- **Decision**：外部身份注册表的键是「平台 + 对象种类 + id」，其中 id 存 GraphQL 全局 node id。
  **Rationale**：实测同一个 change request 在 REST 的 `pulls/5` 与 `issues/5` 上给出两个不同的数字 id（`4588791734` / `5523780322`），只按"平台 + id"建键会为同一个对象建出两行；跨面一致的值只有 node id。对象种类必须显式存储：`ProjectV2Item.type` 与 `__typename` 词形不同，且 `DraftIssue` 连 `number` / `repository` 都没有，靠 id 前缀推断种类不可靠。完整依据与反例见 `docs/architecture/gate-e1-content-identities.md` §3。
  **Date/Author**：2026-09-21 / agent

- **Decision**：用一个一次性探针项目实测沙箱的创建步骤，跑完立即删除。
  **Rationale**：验收项 1 要求"重建步骤逐条可复制"。只核对 `gh <cmd> --help` 等于把命令可用性当假设，而本门禁存在的理由就是消灭这类假设。探针建在共享沙箱之外（一个新的 user-owned project），只做字段创建、条目创建、条目读取、项目删除；删除后项目列表实际返回 `numbers=[12,11,10,9,8,5,4,3]`，探针编号不再存在，未触碰任何夹具。
  **外部写入记录**：actor=agent；目标=GitHub user-owned project（探针，编号 `13`，node id `PVT_kwHOAY1ahM4BkKDd`）；幂等键=无（一次性，删除即回收）；结果=`create` → `field-create` ×2 + `createProjectV2Field` ×1 → `item-create` ×1 + `item-add` ×1 → `delete`，全部 exit 0，删除后回读确认编号 `13` 不再存在。
  **Date/Author**：2026-09-21 / agent

- **Decision**：**~~本 ExecPlan 不更新索引~~，改为索引行随本批次提交。** Superseded（2026-09-22）：原决定是"`docs/README.md` 与 `docs/architecture/README.md` 本批次不改，索引由栈级联步骤更新"，理由是"移动文件或改索引会在级联变基时制造删除/修改冲突"。
  **为什么改**：该理由只对"移动文件"成立；索引行本身在级联时是**追加**，冲突形态是两边都保留、可机械解决，而"延后"制造的是另一类代价——计划里同一个集合出现两份相反的声明，并且它把一个可独立验收的交付物拆到了另一个 PR 里。**风险预判确实发生了**（`docs/README.md` 在同一个插入点与 `main` 冲突），但那是"两边都加一行"的可解冲突，不是必须回避的冲突。现在的规则见 `PLANS.md` §4「一个事实只写一处」。
  **Date/Author**：2026-09-21 / agent（2026-09-22 按 PR 评审推翻）

- **Decision**：栈内 PR 的关闭引用语义写进 `docs/project-management/merge-queue.md` §4.4，而不是只留在 PR 描述里。
  **Rationale**：这条语义是接手的人判断"合并前该看什么、合并后该补什么"的直接依据。PR 描述不是仓库内容，不随 `git checkout` 出现——`merge-queue.md` §1 记录的 2026-09-18 那轮失败正是同一类问题的前例。
  **Superseded 部分（2026-09-22）**：本条原先写的是"`Closes #N` 只在 base 是默认分支时登记为关闭引用，交叉引用仍然产生但 `willCloseTarget: false`"。该**机制**已被 `merge-queue.md` §4.4 推翻（同一批对象上再读一次，关闭引用齐全、`willCloseTarget: true`；机制未确定）。决定本身（写进 §4.4）不变，被推翻的只是它引用的机制。
  **Date/Author**：2026-09-21 / agent（2026-09-22 标 Superseded 部分）

## Idempotence and Recovery

- 三条实验全部是**读**操作加一次夹具创建，可重复执行；重复执行会在沙箱里留下重复夹具，因此重跑前先按拆除步骤重建沙箱。
- 验证命令只读且可重复。
- 沙箱的拆除步骤写在沙箱定义文件里；仓库回滚不影响沙箱，沙箱删除不影响仓库——两者互为独立恢复单位。
- 回滚单位是单个提交。

## Interfaces and Dependencies

- **外部工具**：`gh`（已认证，具备 `repo` 与 `project` 权限）与 GitHub GraphQL API。
- **外部资源**：一个私有沙箱仓库、两个 user-owned Project v2。它们的 id 记录在沙箱定义文件里。
- **命名契约**：记录里的沙箱对象一律用 `$E1_OWNER` / `$E1_REPO` / `$E1_PROJECT_A` / `$E1_PROJECT_B` 引用，赋值只在沙箱定义文件里出现一次。
- **后续工作项**：E1-2（#23）、E1-3（#24）复用本批次的沙箱与模板；E1-4（#25）读取三份记录并裁决。

## Outcomes & Retrospective

**三条实验的判定**：全部 pass，依据逐条写在 `docs/architecture/gate-e1-content-identities.md` §2–§4 的第 8 项。

**跨 project 内容身份复核**：对 issue #2 执行 `gh api graphql` 查询其 `projectItems`，返回内容 id `I_kwDOUjWAl88AAAABST4Wtw`，以及 Project A / B 的成员关系 id `PVTI_lAHOAY1ahM4BkJ9rzg75k64` / `PVTI_lAHOAY1ahM4BkJ9szg75k8c`；因此内容身份跨 project 稳定、成员关系按 project 分裂，命题已从未验证清单移出。

**跨 API id 形状的观测结果**（本批次最可复用的一条）：

| 对象种类 | GraphQL 内容 id | REST 面 id | 跨面一致的 node id |
|---|---|---|---|
| issue | `Issue.id` = `I_kwDOUjWAl88AAAABST4WDQ` | `issues/1.id` = `5523772941` | `I_kwDOUjWAl88AAAABST4WDQ` |
| draft | `DraftIssue.id` = `DI_lAHOAY1ahM4BkJ9rzgLKQZo` | 无 REST 对象 | —— |
| change request | `PullRequest.id` = `PR_kwDOUjWAl88AAAABEYNntg` | `pulls/5.id` = `4588791734`；`issues/5.id` = `5523780322` | `PR_kwDOUjWAl88AAAABEYNntg` |

结论：**id 这一格存 GraphQL 全局 node id；对象种类显式存储并参与键**。REST 的数字 id 只是某个 API 面内的局部标识——change request 在两个 REST 端点上各有一个，且互不相等。

**工作项计数**：E1-1 的三条夹具映射为成员关系 3 条、工作项 2 个（issue + draft）、变更请求 1 条；Project A 全部 7 个条目映射为工作项 6 个、变更请求 1 条。change request 不产生第二个工作项。

**还有哪些身份假设没有真实平台证据**（完整清单见记录文件 §4，这里是摘要）：

- draft 转换成 issue 之后内容 id 是否变化——`draft-convert` 夹具本批次只读，归 E1-2。
- 字段写入如何改变成员关系的 `updatedAt`——写操作属 E1-3 范围，本批次只读。
- change request 的多 project 成员关系形态——本批次未建该夹具。
- `ProjectV2ItemType.REDACTED` 的触发条件与 `content` 形状——需要删除内容，未观测。
- 分页边界（本次所有查询都在单页内返回）——未观测。

**复盘**：本批次最大的收获不是三条 pass，而是三条"原本会写错"的形态：REST 两个面的 id 不等、draft 的字段是 schema 层面不存在、条目连接有读后写延迟。前两条决定数据模型的键，第三条决定同步幂等性的判定方式——它们都只有在真实平台上跑才会出现。代价是：沙箱创建步骤本身没有逐条重跑，只用探针覆盖了可执行部分；这条限制写在 Surprises 第 8 条，不隐藏。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #22 要求先写 ExecPlan 再开始观测，并把它作为 #4 的第一个子 issue 承载沙箱与记录模板。
- 2026-09-21：加入队列记录项。原因是实测发现**栈内 PR 的 `closingIssuesReferences` 为空**——当时据此推断"GitHub 只在该 PR 的 base 是默认分支时才把 `Closes #N` 变成关闭引用"。**该推断已被推翻**：同一批对象上再读一次，关闭引用齐全、`willCloseTarget: true`；机制未确定。订正见 `docs/project-management/merge-queue.md` §4.4，本计划不再断言该机制。这条语义只写在 PR 描述里会随 PR 一起消失，必须落进 `merge-queue.md`；本批次是本栈的入口，因此由它承载队列表的更新。
- 2026-09-21：完成沙箱定义、九字段模板与三条实验记录；实测确认 REST 的 issues 面与 pulls 面对同一个 change request 给出两个不同数字 id，注册表键判定为「平台 + 对象种类 + id」。
- 2026-09-21：用一次性探针项目实测沙箱创建步骤的可执行部分并立即删除；删除后的项目列表**当时**返回 `numbers=[12,11,10,9,8,5,4,3]`，探针节点查询返回 `NOT_FOUND`，不再沿用"回到只剩 11/12"的表述（重跑会污染共享沙箱）。这是账号级快照，会随看板增删变化，不构成长期事实。探针的外部写入记录见 Decision Log。
- 2026-09-22：按 PR 评审重写范围与易失状态，并把规则修在产生它的那一层。原因：评审指出本计划同一文件集合写了 7 处、其中 5 处说"不改这两个文件"而 diff 改了它们，且索引更新被标成"延后"与范围声明互相否定；机械调查进一步显示同一缺陷在本轮六份计划里命中五份、证据缺执行上下文命中六份。改动：(1) 文件集合改为只在 `Global Constraints` 声明一次，`Plan of Work` / `Progress` / `Decision Log` / 本节只引用不复述；(2) Surprises 第 7、9 条与 Decision Log 的"不更新索引"按 `PLANS.md` §4 标 `Superseded` 并保留原文；(3) 易失值（行数、项目列表）改成"回读命令 + 期望"或标注为当时快照；(4) 所有命令补执行上下文，`gh stack view` 那条改成带 `cd` 的实测三态；(5) `PLANS.md` §4 增补四条活文档一致性规则——本批次因此多一个文件，见 `Global Constraints`。
- 2026-09-22：按第二轮评审的 9 条意见修改（逐条核对全部属实）。**没有逐条打补丁**：D8 把它们归并成三个根机制（R1 内容断言没有强制点、R2 易失的本地状态仍被写成值、R3 声明强于实际），主要矛盾是 R1——第一轮把规则写进 `PLANS.md` 只是声明，强制点在能失败的检查里。改动：(1) 规划字段值行的计数口径在沙箱 §6 定义一次（只计用户可写），三处实验与汇总表按同一定义改为 1 / 1 / 1，原值保留在订正注记里；(2) 沙箱 §4.1 拆成「当前状态回读（快照，标注时刻）」与「重建等价判据（只写形状，无 id 字面量、不依赖 E1-2 转换后的状态）」；(3) 凭据 scope 清单改为需求 + `gh auth status` 回读，两处副本收归一处；(4) 跨 PR 引用标注交付方；(5)「唯一赋值处」限定为变量赋值；(6) 分支前缀列表补 `test/`（D9）；(7) 新增 `tests/contract/e1-evidence-consistency.test.js` 作为 R1 的强制点。Global Constraints 因此新增该测试文件、`AGENTS.md` 与 `docs/development/repository-rules.md` 三个条目，并记录 `docs/README.md` 的 +1/−1。
- 2026-09-22：**如实记录一次验证失败**。本轮计划由 gpt-5.6-sol 做独立对抗验证，两次尝试都返回 null（子代理失败），因此回归搜索（§4.1 引用、旧口径残留、凭据字样、声明与改动集对照）与注入实验由编排者自己执行；注入实验同时发现新断言比其作者自述的更强——把实验 2 的行数与汇总表**同时**改成一致的错值，仍会因该行自己枚举的"只有 `Status` 可写"而变红。真正的盲点收窄为"数字与它的枚举一起改错"，已记入 `Validation and Acceptance` 第 8 项。
- 2026-09-22：按第三轮评审的 6 条意见修改（1 条 P2、5 条 P3，逐条核对全部属实）。**P2 是 R1 的残留**：`Validation` 第 1 项把 `gate-e1-sandbox.md` 明确标为「（快照，不是重建判据）」的材料写回了验收表，并带回第二轮已删除的「转换条目当前为 `ISSUE`」——该半句在**当前**沙箱上为真（只读回读确认 `PVTI_lAHOAY1ahM4BkJ9rzg75lAw` 现为 `ISSUE` #6），但在按 §3 重建出的沙箱上必假，因此比单纯写错更难被发现；同批新增的契约测试不解析 §4.1 与 Validation 表，所以没有任何断言会失败。**P3 五条**：Batch 2 的四个复选框未勾；本文件 `:246` 的体量期望「代码 0」在纳入契约测试后不可能成立；契约测试的 `stated.length === 0` 分支只发 diagnostic、可静默失去强制点（另外两条 skip 路径都有下限断言）；`merge-queue.md` §4.3 的 #105 行漏列 `AGENTS.md` / `PLANS.md` / `repository-rules.md` / `docs/architecture/README.md` 与新增的测试文件；`PLANS.md` §4 第 4 条在从属文档里豁免了 `AGENTS.md` §3 的 worktree 路径禁令，却没有改 §3——修法是让豁免落在被豁免的那条规则里。**归档**：全部验收通过，按 `PLANS.md` §2 移入 `docs/exec-plan/completed/`。
