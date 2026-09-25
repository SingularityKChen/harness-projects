# 评审根因收敛 ExecPlan（第三轮响应 + 第四轮收敛）

> 状态：Active
> 创建：2026-09-24
> 范围：把第三轮 MMP 评审在 PR #121 / #122 / #157 / #167 / #170 / #175 上留下的未解决 inline 收敛成少数几条根因，在**拥有该事实的那一层**修一次；同时如实记录第三轮响应的落地率与第四轮的逐条判定。
> 上游输入：六份 PR 的第四轮 review threads（未解决 72 条）、逐层记录（`docs/review/2026-09-24-pr-121-mmp-round3.md` 等六份，命名规则见 `docs/review/README.md` §8）、`docs/review/2026-09-24-sqlite-v1-stack-round3.md`（随 L6 合入）、`docs/exec-plan/active/2026-09-23-sqlite-v1-stack.md`（控制计划）、`docs/review/responding.md`、`PLANS.md` §4

## Purpose / Big Picture

完成后，一个没有本次对话历史的人可以做到四件事：

1. 从这一份文件读到第四轮 72 条意见的逐条判定（属实 / 部分属实 / 不属实 / 过严）、它归属的**单一权威**、以及本轮在那一处改了什么；
2. 读到一份诚实的账：**第三轮的 74 条里哪些回复称已修但实际没有落地**，以及让这一类不再复发的机制是什么；
3. 对着栈顶跑 `node --test tests/contract tests/integration tests/e2e tests/mvp0`，看到「两个实现跑同一套断言」成立的既是**断言文本**也是**前置状态**（装配处没有裸 SQL 直插）；
4. 对着任意一层跑 `node scripts/rule-checks.mjs size "$BASE"`（`BASE` 回读该层 PR 的 `baseRefOid`）看到体量合规。

最小成功证据（三条，缺一条本轮不算完成）：

| # | 证据 | 判定命令 |
|---|---|---|
| 1 | 每条未解决 inline 都有处置：修掉（带判别性证据）、转 issue、或技术反驳 | 本文件 `Validation and Acceptance` 的逐条处置表 + 各 PR thread 的回复 |
| 2 | 两个实现在**同一前置状态**下跑全部契约组，装配处无裸 SQL | 栈顶 `node --test tests/contract` |
| 3 | 每层体量与发布面合规 | 逐层 `BASE=$(gh pr view <n> -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 后跑 `size` / `disclosure` / `git diff --check` |

**本轮不声称六层可以合并。** 合并顺序与是否合并由人类伙伴决定（`AGENTS.md` §6）。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 根因簇 | 一组症状不同、但由**同一个权威缺失或同一个键形状错误**产生的意见 |
| 单一权威 | 某个事实在仓库里唯一可以判定的地方：表与约束、端口契约、契约套件装配处、或某一份计划 |
| 易失值 | 只在某个时点为真的值：head SHA、base SHA、用例数、体量行数、`mergeable` 状态、分支名 |
| 时点事实 | 只有某个合并点之后才为真的事实；栈底文档写它就是「用 `main` 声称尚未评审的层已通过」 |
| 判别性证据 | 缺陷存在时必须变红的用例；每条修复配一次「改坏 → 红 → 还原 → 绿」的注入实验 |

### 第四轮取证（2026-09-24）

| 事实 | 证据（取证命令） |
|---|---|
| 六个 PR 全部 OPEN、非 draft、`mergeStateStatus = BLOCKED` | `gh pr list -R SingularityKChen/harness-projects --state open --json number,baseRefName,mergeStateStatus` |
| 第四轮未解决 inline 共 72 条：#121 15、#122 19、#157 11、#167 11、#170 7、#175 9 | `gh api graphql` 取各 PR 的 `reviewThreads(isResolved: false)` |
| `PR size` 在 #167 上红；`PR Fast Gate` 仍绿（size 不在聚合 job 里） | `gh pr checks 167`；`.github/workflows/rule-checks.yml` 的 matrix 与 `ci.yml` 的聚合 job |
| 六层基线测试全绿：contract+integration+e2e+mvp0 = 521 / 547 / 558 / 583 / 613 / 641 | 逐层 `node --test tests/contract tests/integration tests/e2e tests/mvp0` |
| 体量（相对各层自己声明的 base）：L1 代码 362、文档 1494；L2 代码 1000、文档 1486；L3 代码 554、文档 245；L4 代码 1110（超）、文档 508；L5 代码 917、文档 685；L6 代码 633、文档 680 | 逐层 `node scripts/rule-checks.mjs size "$BASE"` |

### 第三轮响应的落地率（本轮的第一个发现）

第三轮响应的逐条处置表把 74 条判成「属实」并写了处置，但第四轮在**当前 head** 上复跑反例后发现相当一部分没有落地。这不是「评审过严」，而是**回复与落地之间没有机械联系**：处置写在计划的一张表里，落地写在代码与文档里，两者靠人手工对齐。第四轮点名的「作者回复称已修、实际未修」至少覆盖六层全部：

| 层 | 回复称已修 | 当前 head 实测 |
|---|---|---|
| L1 | 证据守卫的两个逃逸已收口 | 行首绑定核对仍可被引号 / `export` / 缩进绕过；沙箱绑定未进 `localNamesById` |
| L2 | 时点事实、端口注释、文件集合、缩进 | 除 ADR-0006 一处外都没有改；`2026-09-24-stack-review-response.md` 里的时点事实仍在 |
| L3 | 5 条计划类意见已修 | 层计划 Spec 仍在描述另一份 schema，只加了一条 Progress |
| L4 | 基线换成回读式配方 | 计划里 `gh pr view 170` 命中 0 次；`size` 仍写非祖先 SHA |
| L5 | 遗留 6/9 收窄、最小证据改回读命令 | 三处都没变 |
| L6 | 交叉引用全部改成名字 | 新增行里还有两处编号且都指错 |

**结论（本轮的设计前提）**：处置表本身不构成落地。能防止复发的只有两类东西——**把副本删掉**（没有第二份就不需要同步）和**能失败的检查**（改坏就变红）。

## Design / Spec

### D1. 系统级根因：同一事实的多个副本 + 没有机械判据

第四轮的 72 条按症状分簇后，八个簇里有六个指向同一条机制：

1. **`Closes` / `Refs` 有三份手写副本**（控制计划 Closes 列、层计划正文、收敛计划的 Batch 标题），而权威是 GitHub 的 `closingIssuesReferences`；
2. **体量基线与证据 SHA 写成了值**（分支名、非祖先 SHA、过期计数），而权威是「该层 PR 自己声明的 base」；
3. **跨层事实写在栈底文档里**（ADR-0005、`workspace_binding`、表数量、上层遗留编号），而权威是拥有它的那一层；
4. **契约套件的前置状态有两个来源**（SQLite 侧裸 SQL 直插、替身侧走端口），而权威是装配处；
5. **编号引用**（`遗留 N`、`D N`）在重排与级联后必然漂移，而权威是名字；
6. **计划与 head 不一致**（Progress 未勾、Outcomes 空、评审记录写「未提交」），而权威是 head 上的实测。

**使能条件**：文档与代码预算（L1 文档 1494/1500、L2 文档 1486/1500、L2 代码 1000/1000、L4 代码 1110/1000）把「改正」变成「先删后加」，而删除没有「原文在哪」的判据；同时 `PLANS.md` §4 已经写下了全部这些规则，靠的是评审者手工发现。

**修复方向不是把处置表写得更细**，而是：删掉副本 + 把规则变成能失败的检查。

### D2. 删副本：每类事实只留一个权威

| 事实 | 唯一权威 | 其余位置改成什么 |
|---|---|---|
| 某层是否关闭某个 issue | GitHub `closingIssuesReferences` | 计划里一律写 `Refs`/回读命令，不写字面 `Closes #N` |
| 某层的体量 | 该层 PR 的 `baseRefOid` + `size` | 计划里只写 `BASE=$(gh pr view …)` 配方 |
| 某层交付了什么 | 该层计划的 `Progress` / `Outcomes` | 控制计划与栈级记录只写回读命令 |
| 某张表 / 某个 ADR 的形状 | 拥有它的那一层的迁移与 ADR | 栈底文档不写表名、方法名、ADR 编号结论 |
| 两个实现的前置状态 | `tests/contract/storage-contract.test.js` 的装配处 | 删除裸 SQL seed，每个用例经端口自建前置行 |
| 代码里的交叉引用 | 被引用条目的**名字** | 不再写 `遗留 N` / `D N` |

### D3. 加判据：把三条规则变成能失败的契约测试

**决定**：新增 `tests/contract/plan-facts-consistency.test.js`（L1 拥有），对**本栈声明的计划集合**施加三条可机械判定的规则：① 不写字面 `Closes #N`；② 体量基线不得写成 `size <SHA>` / `size <工作分支名>`（除非同一行标注观察时刻快照）；③ 反引号里的 `docs/…` 路径必须在本检出可解析，或同一行说明它属于未来层。

**为什么这三条**：它们正好是第三轮与第四轮**各复发过一次**的三类。规则写进 `PLANS.md` 只是声明；强制点必须在能失败的检查里——三条都可判定且 fail closed。**范围为什么是「声明的集合」**：全仓扫描会把无关的 active 计划一起判红；声明的集合与 `e1-evidence-consistency.test.js` 的 `DECLARED_E1_PLANS` 同一纪律，发现与声明不一致也失败。**Superseded by Progress（2026-09-24，按内容自发现）**：声明式清单在新增一份本栈计划时会因忘记登记而静默缩小范围，守卫改为「引用控制计划路径者即是本栈计划」；原文保留。

### D4. 契约套件：前置状态只有一个来源

**决定**：删除 `storage-contract.test.js` 的裸 SQL 预置（L5 的 `seedSyncPrereqs`、L6 的 `seedPrereqs`）。每个共享用例用**端口方法**建立自己需要的前置行；SQLite 与替身因此拿到同一份前置状态。仍然存在的实现分叉写成共享组里的显式用例或登记为带 issue 的遗留。

**为什么**：同一套断言跑在两份不同的前置状态上时，「A 实现接受、B 实现拒绝」这类分叉在契约层看不见——这正是「两个实现跑同一套」在第四轮被实测证伪的原因（去掉直插后 SQLite 红 7 条，替身同名用例全绿）。

### D5. 代码缺陷按「编码歧义」与「入口不统一」两类收口

1. **`''` 与 `undefined` 的编码歧义**：`isComparableSourceVersion`（由 L3 新建，本合并点不存在）是「载体是否可比」的唯一权威，它在 L3 中的定义域曾包含空串，而空串又是 `undefined` 的落库编码。收口在这一处：`undefined` 是「没有版本」的唯一表达，空串不是合法载体，入口拒绝。两个实现因此对同一输入给同一答案。
2. **多语句写入没有统一入口**：`atomic`（由 L4 新建）是唯一原子入口，L4 中 `replacePlanningProjections` 曾走 `mutate`。收口在调用点，并补一条「外键失败不得留下半写行」的判别性用例。
3. **引用完整性的分叉清单按实测重写**：不依赖 core 的几条（运行 / 写尝试 / 关系的工作区边、观察的绑定边、两个状态枚举）在两个实现上对齐并配共享用例；依赖 core 的三条（关系端点、仓库登记、工作项）保留为遗留并各有 issue 承载。

### D6. 体量：把「移动」与「新增」分开，而不是申请豁免

**决定**：L4 的契约套件切分改成**只抽出同步组与执行组**，地基组留在 `suites/storage.js` 原地不动。

**为什么**：`size` 计「增删之和」，被移动的行会被算两次。实测 L4 的 1110 行里 686 行是切分本身；地基组留在原地后降到 1000 以内。**这是最小改动**：不动 `AGENTS.md` §8 的规则（改规则是门禁变更，按 `docs/review/README.md` §6 要单独提交并由人类伙伴决定），也不新增第 7 个 PR。**被放弃的方案**：① 让 `size` 用 `git diff -M` 识别纯移动——实测无效（`-M` 与 `-C --find-copies-harder` 都识别不出 1→3 切分）；② 为这一层批准一次性豁免——豁免没有收口条件，且把「预算耗尽」这一根因固化；③ 把切分拆成独立 PR——多一层就多一份 base 链与评审面。

### D7. 提交粒度按「可独立回滚的交付物」

每层收敛为：① 该层的代码交付；② 该层的判别性用例；③ 该层的计划、ADR 与索引。每个提交带正文（为什么）与 `Refs #N`。第三轮的提交正文为空、没有 `Refs`，本轮的级联推送一并修正。

## Global Constraints

- **文件所有权**：逐层清单以各层 ExecPlan 的 `Global Constraints` 为权威（控制计划不复述）。本计划跨层改动：`packages/capabilities/src/observation.ts`（L3 拥有版本载体语义）、`tests/contract/storage-contract.test.js` 与 `tests/contract/suites/**`（L4 拥有装配，L5/L6 拥有各自组）、`packages/providers/fake/src/storage.ts`（各层拥有自己那一面）。`packages/core/**` **不改**：core 与 SQLite 之间的阻塞点转成 issue。
- 每个 PR：代码 ≤1000 行、文档 ≤1500 行，用**该 PR 自己声明的 base** 判定。
- 不新增运行时依赖；数据库只用 Node 内建的 `node:sqlite`。
- 只允许 rebase merge；agent 不自行合并 PR。
- 不写本机绝对路径、凭据、账号个人信息（`docs/development/publication.md`）。
- 共享历史改写前先建 backup ref，再用精确 old head 的 `--force-with-lease`。
- `Status` / `blocked-by` / `blocking` 必须有人类批准；agent 只准备可审阅结果（`AGENTS.md` §7）。

## Plan of Work

### Batch A · L1 #121：删掉栈底的跨层副本，把三类规则变成检查（`Refs #119`）

**最小闭环**：栈底文档不再断言 L2–L6 的事实；`Closes` 不再有手写副本；两个守卫的逃逸与三类规则都变红。
**涉及文件**：控制计划、L1 层计划、`gate-e1-ruling.md`、`gate-e1-uncertain-create.md`、`ADR-0004`、评审记录、`merge-queue.md`、`tests/contract/e1-evidence-consistency.test.js`、新增 `tests/contract/plan-facts-consistency.test.js`
**验证**：`node --test tests/contract`（524 pass）；四个守卫变异与三个规则注入实验各自红/绿；`size origin/main`（代码 518、文档 1496，exit 0）。
**回滚**：`git revert` 本层四个提交。

### Batch B · L2 #122：替身的引用完整性有断言，ADR 与计划回到本层时点（`Refs #27`）

**最小闭环**：替身新增的引用完整性检查有判别性用例钉住；ADR-0006 与层计划只写 L2 合并点为真的事实；时点事实就地标注。
**涉及文件**：`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage-identity-membership.js`、`tests/integration/identity-membership-schema.test.js`、`tests/e2e/chain-bootstrap.test.js`、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`、层计划、`2026-09-24-stack-review-response.md`、`docs/review/2026-09-24-pr-122-mmp-round3.md`
**验证**：`node --test tests/contract tests/integration tests/e2e tests/mvp0`；体量用回读式 `BASE=$(gh pr view 122 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 再跑 `size "$BASE"`（**代码必须 ≤1000**——本层代码已在 1000/1000，任何新增先用死代码删除腾出）。
**回滚**：`git revert` 本层提交。

### Batch C · L3 #157：版本载体的定义域、003 的约束审查与计划/head 一致（`Refs #28`）

**最小闭环**：空串不是合法载体；003 的 63 列都在审计白名单内，约束的判别性证据见集成用例（**第五轮订正**：45 个 DDL 变异中仍有未钉住的，见 #201），不是每条约束都有判别性证据；层计划与裁决的偏离就地标注。
**涉及文件**：`packages/capabilities/src/observation.ts`、`packages/storage/sqlite/migrations/003_control_facts.sql`、`packages/providers/fake/src/storage.ts`、`tests/contract/capabilities-observation.test.js`、`tests/integration/execution-relation-write-schema.test.js`、`docs/architecture/gate-e1-ruling.md`、`docs/adr/ADR-0002-membership-identity-separate-from-content.md`、层计划
**验证**：`node --test tests/contract tests/integration`；注入实验：正则放宽回允许空串 → 空串用例红；去掉一条 CHECK → 对应用例红；删白名单一列 → 审计用例红。
**回滚**：`git revert` 本层提交。

### Batch D · L4 #167：切分只移动必要的行、多语句写入走 `atomic`（`Refs #163`）

**最小闭环**：`size` 降到 1000 以内；`replacePlanningProjections` 是原子作用域；切分账与守卫基线按本层 base 实测。
**涉及文件**：`tests/contract/suites/storage.js` / `storage-sync.js` / `storage-execution.js`、`tests/contract/storage-contract.test.js`、`packages/storage/sqlite/src/storage.ts`、`tests/integration/storage-restart.test.js`、层计划
**验证**：体量用回读式 `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 再跑 `size "$BASE"`（**期望 exit 0**，改前 1110 超限）；注入实验：`atomic` 改回 `mutate` → 半写用例红；断言集合守卫两个变异各自红。
**回滚**：`git revert` 本层提交。

### Batch E · L5 #170：装配处无裸 SQL，同步面的分叉有用例（`Refs #164`）

**最小闭环**：共享用例的前置状态只走端口；观察的绑定父边在两个实现上同语义；三处修复各配判别性用例。
**涉及文件**：`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage-sync.js`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`tests/integration/storage-sync-surface.test.js`、层计划
**验证**：`node --test tests/contract tests/integration`；注入实验：去掉替身的绑定存在性检查 → 共享用例红。
**回滚**：`git revert` 本层提交。

### Batch F · L6 #175：两个实现同一前置状态，执行面的分叉清单按实测（关联 #120 · `Refs #5`；`Closes` 的唯一权威是回读 `closingIssuesReferences`）

**最小闭环**：装配处无裸 SQL；执行组的分叉清单与实测一致且不依赖 core 的几条已对齐；索引与计划不再写「本层关闭 #5」。
**涉及文件**：`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage-execution.js`、`packages/providers/fake/src/storage.ts`、`docs/README.md`、层计划、两份评审记录
**验证**：`node --test tests/contract tests/integration tests/e2e tests/mvp0`；注入实验：装配换回裸 SQL 直插 → 共享用例红。
**回滚**：`git revert` 本层提交。

### Batch X · 把没有 issue 承载的前置条件开成 issue

**最小闭环**：第四轮点名的、没有 issue 承载的前置条件各有同仓 issue。**已完成（2026-09-24，外部写入，逐条回读）**：① #195 仓库的外部身份种类被 002 的 CHECK 拒绝；② #196 未登记的工作项在 SQLite 上抛裸外键错误；③ #197 `core` 的 `implementationKey: domain`；④ #198 development 域把提交 sha 当 `sourceVersion`（sha 不可定序）；⑤ #199 core 不把 storage 的拒绝翻译成结构化失败（freshness 仍 healthy）。`#132` 的 `blocked-by` 关系**待人类批准**（`AGENTS.md` §7），批准后写进本计划的 Decision Log。
**验证**：逐条 `gh issue view <n> -R SingularityKChen/harness-projects` 回读。

### 收尾 · 级联、整理提交、回读、回复

- [ ] 逐层 `git rebase --onto <新父> <旧父>` 并复跑该层验证命令
- [ ] 每层整理提交（正文 + `Refs`），建 backup ref 后精确 `--force-with-lease` 推送
- [ ] 回读每层 head、base、checks、`closingIssuesReferences`
- [ ] 刷新六个 PR 描述（`Closes`/`Refs`、验证证据、风险、回滚）
- [ ] 逐条回复 72 条 thread 并 resolve（有证据的 resolve；反驳的说明依据）

## Validation and Acceptance

### 逐条处置表（第四轮 72 条未解决 inline）

判定口径：**属实**＝反例可复现且影响系统不变量或验收证据；**部分属实**＝结论成立但范围或归因需要订正；**过严**＝反例成立但要求的修复超出该层授权面或与最小充分设计冲突；**不成立**＝反例不成立或规则依据不成立。每条的复现命令与实测输出记录在对应 PR thread 的回复里。

| PR | 意见 | 判定 | 处置 |
|---|---|---|---|
| #121 | 控制计划仍断言 L2 的设计结果并引用 ADR-0005 | 属实 | 删掉整节「目标表 → 端口方法映射」，Surprises 里的「已删除……见 ADR-0005」改成「处置归 L2」 |
| #121 | `Refs #119` 的理由不在本层任何文档里；两份计划仍写死关闭断言，验收 1 仍勾选 | 属实 | 两处改 `Refs` + 理由写进层计划；验收 1 改如实登记；两条出路进 `Decision Log` 与裁决 §9 |
| #121 | `unresolved` 的新定义只改了记录，R8 / ADR-0004 / 控制计划 / 记录共 5 处仍是旧判据 | 属实（比意见多一处：记录 `:551`） | 五处统一到裁决 §4 的 R8 行（「对账窗口结束后仍不唯一」） |
| #121 | 作者响应指向 L2 才有的收敛计划，「14 条全部处置」与 head 不符 | 属实 | 两处指针改成 PR 引用；「全部处置」按实际改写并就地订正 |
| #121 | 重组后的 4 个提交没有正文，也没有 `Refs #119` | 属实 | 本轮 4 个提交都带正文与 `Refs #119` |
| #121 | 控制计划的 `Closes` 列与六个 Batch 标题是三套互不相同的答案 | 属实 | 整列删掉，换成 `closingIssuesReferences` 回读命令；标题改成 `Refs` 或带回读依据 |
| #121 | 行首绑定核对可被引号 / `export` / 缩进绕过；沙箱绑定未进 `localNamesById` | 属实 | 正则放宽 + 沙箱绑定预填；四个变异（M6q / M6x / M6i / M9）全部变红 |
| #121 | §9 的新条目插在一句话中间 | 属实 | 接回原句行尾，新条目放其后 |
| #121 | 为压预算删掉别处没有原文的内容；两份计划没有追加 `Bottom Change Note` | 部分属实（控制计划有本轮的 Change Note，另外 4 块没有） | 删掉只剩表头的空表并把理由并进「本轮不做的事」；追加 `Bottom Change Note` |
| #121 | 验证命令里还有分支名基线、缺 `-R`、不可解析的 SHA | 属实 | 全部改成回读配方或就地标注「观察时刻快照，不可复跑」 |
| #121 | D4 说命令形状「见下方的订正」，可下方没有订正 | 属实 | 在命令块补 `Superseded` 注释并指向记录实验 3 §3 |
| #121 | 「判 pass」「≈9 s / ≈4 s」「状态取值集合」还有没加限定的落点 | 属实 | 控制计划与层计划补「L1 提议，待人类伙伴采纳」；延迟数值的权威收敛到记录实验 2/4 |
| #121 | 被宣布为唯一权威的文件清单仍漏文件；R4 行尾句号仍在 diff 里 | 属实（句号一项属编辑事故，不改变事实） | 清单补齐到与实际 diff 逐一相等；句号未撤，理由记在回复里 |
| #121 | 回滚写「按 `docs/` 的备份恢复流程重建」，但 `docs/` 里没有这份流程 | 属实 | 改成「删除库文件重建（D10）」；同一份计划里两套回滚答案收敛成一套 |
| #121 | `merge-queue.md` 没写栈成员必须用 `merge-async` 合并 | 属实，**归属层应为 L6** | 转 L6 的 `merge-queue.md` 改动（L1 文档余量只有 4 行） |
| #157 | 空串既是合法载体，又是 `undefined` 的落库编码 | 属实 | 定义域收紧为**非空** ASCII（`isComparableSourceVersion` 是唯一权威）；两个实现同答案 |
| #157 | 「提交 sha 字典序即目标序」不成立 | 属实 | 删掉这条断言；「字典序即目标序」写成 provider 的义务，development 域用 sha 是 provider 侧缺口 |
| #157 | 大小写定序用例没补；「`localeCompare` → 红」的注入实验不成立 | 属实 | capabilities 套件补码点序 vs UTF-16 码元的反例（注入实验实测红/绿）；契约组的另外三格由 L5 的同步组承载 |
| #157 | 脱敏只写在注释里：003 的 63 列没有凭据审查 | 属实 | 补 11 表 63 列的 `AUDITED` 白名单 + `pragma_table_info` 互相覆盖 + 列名凭据形态检查 |
| #157 | 作用域结论只写进 ADR-0006；webhook 的键与 ADR 相反 | 属实 | DDL 改成 `UNIQUE (workspace_id, binding_id, scope_key, event_name)`（零新增行）+ 拒绝用例 |
| #157 | 层计划的 Spec 仍在描述另一份 schema | 属实 | 就地逐处 `Superseded` + 写当前事实；补 Decision Log 记录三个决定与放弃 ISO-8601 的理由 |
| #157 | `rejects` 丢掉第三个参数，15 处匹配器是死参数 | 属实 | helper 改三参数；给 8 条存活的约束/外键变异逐条补拒绝用例 |
| #157 | ADR-0002 已就地标注 Superseded，裁决 §4 的 R4/R8 与「R1 的连带影响」却仍是旧键、旧表名 | 属实 | 在裁决那三处就地追加「偏离，待人类采纳」，并在 §9 登记待决项 |
| #157 | 非 ASCII 载体到 storage 入口才被拒绝，freshness 仍 healthy | 部分属实（「两条都在授权面之外」不准确） | 校验的定义域已在权威处收紧；「把拒绝翻译成结构化失败」在 core 授权面外 → 开 issue |
| #157 | 003 仍在断言「两个实现」「这张表有写者」 | 属实 | 改成义务措辞（本层只有内存替身，SQLite 由 L4–L6 接入） |
| #157 | 两行之上的注释仍是旧模型「同键重放返回原记录」 | 属实 | 按实现的幂等覆盖订正 |
| #170 | 计划仍把「观察落点解析」写成本层现行语义 | 属实 | 计划就地标 `Superseded by L5-H`；验收 27/42、`sync_observation` 主键、「SQLite 不能当 core 的 storage」一段按 head 改写 |
| #170 | `''` 与 `undefined` 在 SQLite 上仍被合并 | 属实（权威在 L3） | L3 已收紧定义域；L5 补一条共享同步组用例钉住 `''` 被拒绝 |
| #170 | 三处修复或声明没有判别性用例 | 属实 | 补三条：事务第三条语句失败后旧行保留、自检失败必须关句柄、`object_kind` 维度各自的版本序列 |
| #170 | 装配处仍用裸 SQL 预置 binding-1 | 属实 | 删掉 `seedSyncPrereqs`，同步组前置状态只走端口 |
| #170 | 代码里的计划交叉引用仍用编号且指错 | 属实 | 三处改成名字引用 |
| #170 | 体量基线仍是非祖先提交，回读式配方不在计划里 | 属实（对象在本 clone 里根本不存在，比意见更重） | 全部换成 `BASE=$(gh pr view 170 …)` 配方；历史行标「观察时刻快照，不可复跑」 |
| #170 | 遗留 6、遗留 9 和「最小成功证据」仍是旧陈述 | 属实 | 遗留 6 标已收口、遗留 9 收窄到 `listFieldValues`；条数与证据改成回读命令 |
| #175 | 直插前置行还在，且范围比上一层更大 | 属实 | 删掉 `seedPrereqs`，SQLite 装配走空库 + 端口建前置行 |
| #175 | 「合并前必做」没做完：#132 没有 blocker 关系，「不声称」与实测不符 | 部分属实（`blocked-by` 超出 agent 授权面） | 重写「本层不声称」并补两条实测阻塞点；两条新前置条件各开 issue；`blocked-by` 交人类批准 |
| #175 | 索引和层计划写「本层关闭 #120 与 #5」 | 属实 | 索引与计划改成「关闭 #120；#5 为 `Refs`」+ 理由；删掉两处过期复述 |
| #175 | 「四条父边、三条已对齐」仍不成立：还有 12 处分叉 | 属实 | 补齐不依赖 core 的六条父边/枚举；依赖 core 的三格写成显式分叉用例；注释改成实测清单 |
| #175 | 本层新增的代码里还有两处遗留编号指错 | 属实 | 两处改成名字引用 |
| #175 | D22、Decision Log 与验收 44 仍写旧模型 | 属实 | 就地标 `Superseded by 收敛计划 D5 / Batch L6-G`；Purpose 与验收改成「幂等覆盖」 |
| #175 | 作者响应表有四处与当前 head 不符 | 属实 | 按真实处置逐行改写 |
| #175 | 栈级记录没有作者响应节 | 属实 | 追加「作者响应（第三轮后）」节；头部去掉「未提交」；§6 第 2 条就地标 Superseded |
| #175 | 验收 59–61 的证据引用的 SHA 都不是 head 的祖先 | 属实（且不可解析，比意见更重） | 换成回读式 `BASE` 或标「观察时刻值（级联前 base），不可复跑」；验收 60 按端口主体改写 |
| #122 | `Refs #27` 的理由前提不成立：声明式「恰好一个 primary」不需要改 `Entity` 或 `ensureEntity` | 属实（评审给的 DDL 已实测可行：生成列 + 普通唯一索引 + 可延迟外键） | 把成本前提改写成真实代价（端口语义 = `putEntity` 须与 primary 身份同事务 + 15 处测试前置），零代码改动 |
| #122 | 新补的「生命周期断言」对「零个 primary」没有判别力 | 属实（把 core 的 `Primary` 改成 `Alias` 后断言仍全绿） | 改成绕过查询过滤、逐项断言 primary 恰一个；注入实验确认失败信息来自本断言 |
| #122 | 替身新增的 6 处引用完整性检查没有任何用例钉住 | 属实（逐条删除后 547/547 全绿） | 地基组补 3 格引用完整性用例；端口 `putExternalIdentity` 上方补一行引用完整性 |
| #122 | core 的 `implementationKey: domain` 缺陷「转 issue 承载」但没有 issue | 属实 | 开 issue 并把号写进 ADR-0006:51 与收敛计划 Batch X |
| #122 | 「不变量 1 未约束派生事实」的收口条件与 issue 都不存在 | 属实 | `Outcomes` 补一条并写明收口条件；并入 #189 或新开 issue（**第五轮订正 2026-09-26**：上一版称已补，实际未补；现已补进 `Outcomes`，承载 #202） |
| #122 | 本层 ADR 与收敛计划写入了只在 L3–L5 才成立的事实 | 属实（本层树里没有 003、没有 `storage-sync.ts`） | ADR-0006 的审计表只留本层三个端口记录；`webhook_subscription` 行与 003 键形状移到 L3；收敛计划改为「L3–L6 中」+ 回读 |
| #122 | 第三轮 R3-9 点名的时点事实除 ADR-0006:49 外都没改 | 属实 | 按装配事实改写 6 处（本合并点只有替身跑这些组）；验收 6 改成回读命令 + 期望 |
| #122 | 新增的第三轮评审记录重复 R3-10 的缺陷 | 属实 | 补「作者响应」节；`:6` 改历史口吻；`pr-122-mvp-review.md` 的状态行同步订正 |
| #122 | D8「谁交付证据谁写 Closes」没有执行 | 属实 | Batch D/F 标题按实际订正；#28 与 #5 的归属二选一并记 Decision Log（**第五轮订正**：Decision Log 补登「#28 / #5 的关闭归属」条） |
| #122 | 实体删除分支已成死代码，文档注释与行为相反 | 属实（删掉整段仍 547/547） | 删掉死分支；注释与端口写明「投影移除、实体与身份保留」（净 −2 行，正好腾给上面的用例） |
| #122 | 守卫正则仍把合规的 `secret_handle` 判成违规 | 属实 | 正则排除 `_handle` / `_ref` 后缀，判定交给逐列白名单 |
| #122 | 约束级出处用例不覆盖行内 `REFERENCES` 外键 | 属实（002 有 7 条行内 REFERENCES，第二个正则只认带 CHECK 的列） | 正则加 `|\sREFERENCES\s`；给 002:22 补一行出处注释 |
| #122 | 用例仍叫「行为 2」，计划引用一个不存在的用例名 | 属实 | 用例改名；同步层计划里的引用与旧正则口径 |
| #122 | 「用户裁定」仍没有批准者、位置和范围 | 属实 | 写好占位结构并标注「待人类确认」；按 `harness-host-spike.md` 的格式 |
| #122 | L2 计划仍称端口风格「不抛错」 | 属实 | 两处改成只描述 `putMembership` 自己的冲突规则，删掉类比 |
| #122 | 文件集合与 Decision Log 没有登记本层实际改动的文件 | 属实 | 更新文件集合与「放弃方案」段；Decision Log 补一条跨列接管记录 |
| #122 | 「过严判定 2」说用上了 `register` 并修正 8 行缩进，与代码相反 | 属实（且那条预算理由算错了账：该文件是本 PR 新增，重排缩进不花 churn） | 改成「删除未使用的 `register`」；顺手修两行缩进（免费） |
| #122 | 收敛计划从 L2 到 L6 一字未改 | 属实（五个 head 的 blob 完全相同） | 本文件重写；Progress 每层自勾，Batch X 标「blocked-by 待人类批准」 |
| #122 | 替身的成员关系排序仍按 UTF-16 码元比较 | 属实 | L2 内联码点序比较器并补 U+FF5E / U+1F600 边界用例（**第五轮订正 2026-09-26**：原处置与代码相反）；L3 落地共享比较器后切换复用 |
| #167 | #163 验收 6 在关闭它的这一层仍不成立 | 属实 | 把关闭断言改成 `Refs #163` 并订正 Progress ③（验收 6 的字面证据在 L6），零代码改动 |
| #167 | 事务令牌的四处修复在本层没有任何用例 | 属实（四个变异全部 537/537 存活） | 把 L5 的那条用例下移进共享地基组并补「提交后定时器调外层实例合法」；代码预算从守卫注释块与头注释删等量行 |
| #167 | 守卫的来处指向不可达的 `8f11e38`，切分前条数不是 16 | 属实（实测 base 是 **18** 条） | 账本改成回读式实测 base：继承 18（7/8/3）、新增 6；补 JSDoc 与级联 Change Note；`8f11e38` 的 17 处引用改回读或标注 |
| #167 | 断言层守卫只能数出净删除 | 属实（改写断言或删一条加一条都全绿） | 按组比对规范化断言语句集合（基线一处，允许显式新增、禁止静默删除）；两个变异实测红 |
| #167 | 代码体量 1110/1000，说明里的数字过期，提议 ① 实测无效 | 属实 | 按 D6 重做切分（地基组留在原地），`size` 回到 1000 以内；计划里的 1103 与提议 ① 改成回读命令与实测结论 |
| #167 | 头注释「差别只是读取时刻」不完整，四处分叉未登记 | 属实 | 头注释与 D8 改成「读取时刻 + 活性 + 作用域生命周期」；遗留清单补四格 |
| #167 | `replacePlanningProjections` 多语句写入却走 `mutate` | 属实（根实例上外键失败留下半写行） | 改成 `this.atomic(...)`（一个词）；补一条「外键失败不留半写行」的判别性用例 |
| #167 | 级联时取了旧版断言消息 | 属实 | 按 base 原文恢复消息（同行替换） |
| #167 | 计划与 head 全面不一致 | 属实 | 计数改回读命令；恢复路径按当前 4 个提交描述；遗留编号改名字引用；订正 Progress ③ |
| #167 | 评审记录已提交却写「未提交」 | 属实 | 改成已完成说法，并把两个不可解析的 SHA 标成第三轮观察点 |
| #167 | 「见本层计划遗留 5」指错 | 属实 | 两处改名字引用 |

### 验收表

| # | 验收项 | 判定证据 | 判定命令（期望退出码 0） |
|---|---|---|---|
| 1 | 每条 inline 都有处置 | 本文件的逐条处置表 + 各 PR thread 回复 | `gh api graphql` 取 `reviewThreads` 回读 |
| 2 | 两个实现同一前置状态跑全部契约组 | 装配处无裸 SQL seed | 栈顶 `node --test tests/contract` |
| 3 | 空串不是合法版本载体，两个实现同答案 | `isComparableSourceVersion` + 共享同步组用例 | 栈顶 `node --test tests/contract tests/integration` |
| 4 | 多语句写入走唯一原子入口 | `atomic` 调用点 + 原子性用例 | 同上 |
| 5 | 三类计划事实规则可机械判定 | `tests/contract/plan-facts-consistency.test.js` + 三个注入实验 | `node --test tests/contract` |
| 6 | 每层体量与发布面合规 | `size` / `disclosure` / `git diff --check` | 逐层 `BASE=$(gh pr view <n> -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 后三条命令 |
| 7 | 没有 issue 承载的前置条件已开 issue | 五条 issue 的 `gh issue view` 回读 | `gh issue view <n> -R SingularityKChen/harness-projects` |

## Progress

> **本节只写 L4 这个合并点为真的事实**（`AGENTS.md` §6：每个 PR 要能独立验收、合并、回滚）。L5–L6 的批次在本层**未交付**，因此不勾选——它们的交付状态由各自的副本与本层 D2 的回读命令判定。

- [x] (2026-09-24) 取证：72 条未解决 inline 逐条读取、六层源码与套件逐行对照、体量与 `gh pr view` 回读、六层基线测试全绿
- [x] (2026-09-24) 归并根因：同一事实的多个副本 + 没有机械判据（D1）
- [x] (2026-09-24) Batch A · L1 #121（四个提交；`--force-with-lease` 已推送）
- [x] (2026-09-24) Batch B · L2 #122（四个提交；本层体量与测试见下方「本层实测」）
- [x] (2026-09-24) Batch X · 开 issue：#195 / #196 / #197 / #198 / #199（逐条回读标题与标签）；`#132` 的 `blocked-by` 待人类批准
- [x] (2026-09-24) 三条规则的**级联预检**：用与守卫同判据的离线脚本逐层跑，发现本计划自己有 5 处违规（跨层 glob 路径、`size <SHA>` 无标注、Batch 标题里的字面关闭断言、处置表引用评审原文），已全部修掉
- [x] (2026-09-24) 把守卫的范围从「逐文档声明」改成**按内容自发现**：声明式清单会让每一层都必须回来改 L1 的文件，而漏登记就静默缩小范围
- [x] (2026-09-24) Batch C · L3 #157（六个提交；本层体量与测试见下方「本层实测」）
- [x] (2026-09-24) Batch D · L4 #167（本层体量与测试见下方「本层实测」；**第五轮订正**：第四轮回复称已修的 11 条里有 5 条当时不在 head 上，第五轮由评审者补齐令牌用例、原文消息、来处回读与「遗留」名字引用，切分守卫的基线来源转 #201）
- [ ] Batch E · L5 #170、Batch F · L6 #175：**本层未交付**
- [ ] 收尾 · 级联、整理提交、回读、刷新 PR 描述、逐条回复并 resolve：**本层未做**

**本层实测（回读式，不写死）**：体量用 `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 再跑 `size "$BASE"`（期望 exit 0）；测试用 `node --test tests/contract tests/integration tests/e2e tests/mvp0`（期望全绿）；72 条回复文本按逐条判定写在运行态文件里，推送后逐条发帖并 resolve。

## Surprises & Discoveries

- (2026-09-24) **处置表不构成落地**：第三轮把 74 条判成「属实」并写了处置，第四轮在同一批 head 上复跑反例，六层都有「回复称已修、实际未修」。机制是回复与落地之间没有机械联系。
- (2026-09-24) **预算是 churn（增+删），而上一轮按「净行数」估算**：`rule-checks.mjs` 的体量是 `added + deleted`，所以「同行替换」的代价是 2。L1 当时只剩 6 churn ≈ 只能改 3 行，而 15 条意见的修复加起来约 70 churn——「改一处、漏四处」不是疏忽，是预算约束下的必然结果。本轮的解法是**先删副本腾预算**，不是逐条压缩。
- (2026-09-24) **`size` 计增删之和，「移动」要被算两次**：L4 的 1110 行里 686 行是契约套件切分本身；只抽出同步组与执行组、地基组留在原地之后降到 1000 以内。`git diff -M` 与 `-C --find-copies-harder` 实测都识别不出 1→3 的切分。
- (2026-09-24) **`PR size` 不是分支保护的必需检查**：`PR Fast Gate` 是聚合 job，`PR size` 是 `rule-checks.yml` 的独立 lane。因此 #167 的 size 红不阻塞合并，但它仍然是 `AGENTS.md` §8 的规则违反，本轮按规则修。

## Decision Log

- **Decision**：新增 `tests/contract/plan-facts-consistency.test.js`，对声明的计划集合判定三条规则（D3）。**Superseded**：范围改为按内容自发现，见 D3 的订正。
  **Rationale**：这三类各复发过一次；规则写进 `PLANS.md` 只是声明，强制点必须在能失败的检查里。三条都可判定且 fail closed。
  **Date/Author**：2026-09-24 / agent

- **Decision**：L4 的契约套件切分只抽出同步组与执行组，地基组留在 `suites/storage.js` 原地（D6）。
  **Rationale**：`size` 计增删之和，移动被算两次；留在原地把 686 行的切分代价降到约 400 行。不改门禁规则，不新增第 7 个 PR。
  **Date/Author**：2026-09-24 / agent

- **Decision**：空串不是合法 `sourceVersion`；`undefined` 是「没有版本」的唯一表达（D5.1）。
  **Rationale**：空串既是「合法载体」又是 `undefined` 的落库编码，两个实现对同一输入给相反答案。收口在 `isComparableSourceVersion` 这一处权威。
  **Date/Author**：2026-09-24 / agent

- **Decision**：删除装配处的裸 SQL 预置，共享用例经端口自建前置行（D4）。
  **Rationale**：同一套断言跑在两份不同的前置状态上时，实现分叉在契约层不可见；第四轮实测去掉直插后 SQLite 红 7 条而替身同名用例全绿。
  **Date/Author**：2026-09-24 / agent

- **Decision**：不采纳收敛计划上一版 D3 的「定宽 ISO-8601」方案，改为「非空 ASCII 可打印」。
  **Rationale**：ISO-8601 会拒绝 development 域的提交 sha 载体，而 sha 本身又不可定序——那条路既解决不了 provider 侧的缺口，又会把两个域之一拒之门外。storage 能判定的只是「比较器与 SQLite BINARY 逐字节等价」，收窄定义域到非空 ASCII 即可闭合编码歧义。
  **Date/Author**：2026-09-24 / agent

- **Decision**：#28 与 #5 的关闭归属**待人类伙伴决定**，各层先写 `Refs`（D8 的补登）。
  **Rationale**：#28 验收 1（重启逐字节恢复）在 L3 做不到，验收 3（库不接受确定性行直接进确认表）尚未在任何层成立——要么在 L6 收口验收 3 后由 #175 关闭，要么收窄验收 1 / 3，两者都是规划决定。#5 的验收 3 要求 core 能以 SQLite 为 storage，承载在 #132（其 blocked-by 是否挂 #187 / #188 / #195 / #196 需人类批准）。
  **Date/Author**：2026-09-26 / agent（第五轮 MMP 评审）

## Idempotence and Recovery

- 全部验证命令只读且可重复；注入实验都要求「先证明变异生效、再复跑确认还原」。
- 迁移文件在首次 MVP 发布前可整份重写（控制计划 D10）；本合并点没有旧库自检（`#assertRewrittenSchema` 由 L4 新建）；处置是删除库文件重建（控制计划 D10）。
- 每层分支已推送后改写历史：先 `git branch backup/<layer>-pre-round4`，再用精确 old head 的 `--force-with-lease`。
- 级联用 `--onto <新父> <旧父>`，逐层复跑该层验证命令；「变基成功」不等于「内容正确」。
- 任一层验证失败即回滚该层到 backup ref，不带着红的上层继续。

## Interfaces and Dependencies

**本轮对内提供的接口**

```text
tests/contract/plan-facts-consistency.test.js   # 新增：三类计划事实规则的判定
packages/capabilities/src/observation.ts   # 由 L3 新建，本合并点不存在
  isComparableSourceVersion(value: string): boolean   # L3：定义域收紧为非空 ASCII
```

**依赖的仓库设置与外部条件**：Node 26（`node:sqlite`），无第三方运行时依赖；`gh` CLI 已登录（`repo` 作用域）；分支保护是线性历史 + `PR Fast Gate` + 批准 + rebase merge。

**依赖的既有决策**：控制计划 D10（发布前不承担迁移与兼容成本）、D9（控制计划管栈、每层各持 ExecPlan）、`docs/architecture/gate-e1-ruling.md` §4 的 R1–R8、ADR-0006。

## Outcomes & Retrospective

**本层的交付状态用验收表的判定命令回读，本文件不断言尚未完成的事。**

**遗留（带收口条件）**：

- **多工作区作用域**：账本是连接级的，两个工作区共用一条连接时共享处理状态。收口条件＝第一个多工作区宿主路径出现之前。
- **`mutation_attempt` 的「未决行是否阻塞第二次外部写」**：阻塞判定归 core 的写状态机。收口条件＝core 写路径出现第二个调用方时。
- **`entity` 的「恰好一个 primary」**：声明式表达（`DEFERRABLE INITIALLY DEFERRED` 复合外键）的代价是 `putEntity` 与 primary 身份同事务写入并改写套件前置，不是端口签名变更（第五轮订正）。收口条件＝L2 / L4 代码预算允许或六层重新划分尺寸时（#190）。
- **不变量 1 的派生层面**：切换 planning 来源（旧挂载停用、新挂载启用）后，旧来源的投影仍留在同一工作区，列表同时显示两个来源的条目（第五轮评审复现：`projections after switch: 10`）。挂载层面由 002 的部分唯一索引保证，投影层面没有。收口条件＝core 出现显式的挂载切换入口时，由端口级联清理或按启用来源过滤；承载 #202。
- **core 与 SQLite 之间的阻塞点**：关系端点、仓库登记、工作项登记三条，各有 issue 承载（Batch X）。

## Bottom Change Note

- 2026-09-24：创建（本文件前身是第三轮的同名收敛计划）。第四轮评审发现第三轮的处置表有相当一部分没有落地，因此本轮把设计前提改成「删副本 + 加机械判据」，并按「拥有该事实的层」重排批次。作者：agent。
