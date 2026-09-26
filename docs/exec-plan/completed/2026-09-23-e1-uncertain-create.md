# 不确定外部创建的裁决证据 ExecPlan

> 状态：Completed（2026-09-26 随 #121 合并归档；#119 保持开启，验收 1 待人类伙伴在补观测与收窄验收之间决定）
> 创建：2026-09-23
> 范围：栈内 L1（issue #119）。为 issue #4 的行为 6「结果不确定的外部创建先对账再重试，且不盲目重试」补上它缺的那一半证据，并据此给出 `pending_external_write` 的**结果轴与获知方式标注**；只改文档与一个契约守卫，不写产品代码。**关联**：`Refs #119`（不是 `Closes`）——验收 1 要求每条观测带墙钟与确切命令，本层记录在 3(a) 与标签回读两处没有逐条记录；补观测要重跑沙箱实验、收窄验收属人类决定，见 `Decision Log` 与 `Progress`。`Closes` 的唯一权威是 `gh pr view 121 -R SingularityKChen/harness-projects --json closingIssuesReferences`。
> 上游输入：`docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`（控制计划，本层是它的 Batch L1）、`docs/architecture/gate-e1-ruling.md`（裁决，§2.6 与 §4 的 R8）、`docs/architecture/gate-e1-sandbox.md`（沙箱定义与九字段记录模板）、`docs/architecture/gate-e1-write-and-events.md`（E1-3 记录，本层的直接上游）、`PLANS.md`

## Purpose / Big Picture

完成后，一个没有本次对话历史的人可以做到三件事：

1. 读到一份按九字段模板填满的记录 `docs/architecture/gate-e1-uncertain-create.md`，其中每条结论都带 UTC 墙钟时间、可复制的命令与平台原文；
2. 读到行为 6 的裁决由 `inconclusive` 变成一个有证据的取值，以及 `pending_external_write` 的**两条正交轴**——结果轴取 `packages/domain` 的 `WriteState`，获知方式轴四个标注（`confirmed` / `reconciled` / `rejected` / `unresolved`）各指名它由哪条观测支持（评审响应订正，2026-09-24：原文写「状态取值集合（4 个取值）」，那是把两条轴装进同一个集合的后果）；
3. 读到一份逐条点名的「未证明的部分」，知道哪些分支仍然没有观测——不用猜哪些结论是推导出来的。

最小成功证据（三条，缺一条本层不算完成）：

| # | 证据 | 判定命令 |
|---|---|---|
| 1 | 记录文件九字段齐全（字段名与顺序取自 `docs/architecture/gate-e1-sandbox.md` §6） | 本计划 `Plan of Work` 的九字段脚本 |
| 2 | 四条实验各有请求、平台原文、墙钟时间与判定，`pending_external_write` 的每个取值都能指到一条观测 | 读 `docs/architecture/gate-e1-uncertain-create.md` §1–§5 |
| 3 | 裁决 §2.6 与 §4 的 R8 行引用本记录，R8 的状态集有出处 | 读 `docs/architecture/gate-e1-ruling.md` §2.6 与 §4 |

**本层不写代码、不建表。** 它交付的是证据与裁决订正；`pending_external_write` 的建表在 L3（#28）。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 自然键（natural key） | 发起写入的那一方**本来就持有**、不依赖平台响应的输入；有它才能在对账里认出"这条对象是我写的" |
| 对账（reconcile） | 重新读平台的对象集合，按自然键查找既有结果；它不依赖事件，也不依赖原写入的响应 |
| 响应丢失 | 写入命令确实执行了，但调用方拿不到响应体。本层用「丢弃 stdout」模拟，**不制造网络故障** |
| 可见延迟 | 从写入返回到对象能被某条查询看到的时间差；不同查询路径的可见延迟不同 |
| 状态取值集合 | `pending_external_write` 的状态机允许取哪些值；R8 规定补证据前不得冻结它 |

### 当前事实（2026-09-23 取证）

| 事实 | 证据（取证命令） |
|---|---|
| 行为 6 判 `inconclusive`，理由是「创建内容那一步响应丢失」分支未实测（**Superseded by L1（#119，2026-09-23）**：该分支已补测，**L1 提议判 `pass`，采纳权在人类伙伴**，见裁决 §9 的待决项） | `docs/architecture/gate-e1-ruling.md` §2.6 |
| R8 要求「补证据前不得冻结该表的状态机取值集合」 | `docs/architecture/gate-e1-ruling.md` §4 的 R8 行 |
| E1-3 只观测了「把既有内容加入 project」这一步的幂等（计数 1），没有观测「创建内容本身」 | `docs/architecture/gate-e1-write-and-events.md` 实验 3 §8 的限定原文 |
| 沙箱存在且可用：私有仓库 `$E1_OWNER/$E1_REPO`（node id `R_kgDOUjWAlw`）、Project A `11`、Project B `12` | `gh repo view "$E1_OWNER/$E1_REPO" --json isPrivate,id`；`gh project list --owner "$E1_OWNER"` |
| 沙箱漂移：`fixture shared`（sandbox issue #2）现在是 `CLOSED`，而沙箱定义 §2.3 仍按 `OPEN` 描述 | `gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --json number,state` |
| 沙箱夹具共 5 条 issue（#1–#4、#6）+ 1 条 PR（#5）+ Project A 7 个条目 | 同上；`gh api graphql` 的 Project A 条目连接（命令见记录 §1 字段 4） |
| 本层的声明 base `test/e1-ruling` 已被第三方重写，随后随 PR #108 合并删除；`main` 尖端含重写后的同一批 L0 提交 | `git merge-base HEAD origin/main`（= 旧 `main` 尖端）、`git log --oneline origin/main`、`git rev-list --left-right --count origin/main...HEAD` |

### 关键路径与本层的位置

控制计划的栈序里，本层是 L1，L0 是 `test/e1-ruling`（PR #108，已合并），**只有 L2 以本层为 base**（L3–L6 依次以上一层为 base，见控制计划 D2 的栈序表）。L3 的 R8 明确要求**获知方式标注**取自本层（**订正 2026-09-24**：原文写「L2/L3/L4 依次以本层为 base」并把 R8 说成「状态取值集合」，两处都与当前事实不符——R8 的**类型**取 `packages/domain` 的 `WriteState`，本层给的是四个获知方式标注；原文引用的控制计划 Batch L3 步骤句也已在控制计划的收口压缩中不存在）。

**声明的 base 与实际父提交不是同一个对象（2026-09-23 实测；下列 SHA 均为观察时刻快照，`a48ccae` / `5497bf7` 已随 `backup/*` 与 `test/e1-ruling` 的删除而不可解析）**：本工作树的分支 `test/e1-uncertain-create` 的父提交是 `a48ccae`（L0 的**重写前**版本），而 `origin/test/e1-ruling` 一度指向重写后的 `5497bf7`，两者内容差 4 行（`git diff --stat 5497bf7 a48ccae`）。PR #108 于 2026-09-23T03:37:49Z 合并后 `origin/test/e1-ruling` 被删除，`main` 尖端是含 L0 的 `4d46559`。**本层不自行 rebase**：级联由控制计划的收尾批次统一执行。后果与两套体量口径见 `Plan of Work` 的「验证」小节。

### 相关文件

| 文件 | 本层怎么用它 |
|---|---|
| `docs/architecture/gate-e1-sandbox.md` | §2.1 变量赋值、§2.3 夹具所有权表、§6 九字段模板与三条填写纪律；本层只在 §2.3 加自己那一行 |
| `docs/architecture/gate-e1-ruling.md` | 本层只改 §2.6 的裁决与 §4 的 R8 行 |
| `docs/architecture/gate-e1-write-and-events.md` | 上一批的记录文件，本层照它的写法与详细程度写；它的实验 3 是本层的直接上游 |
| `docs/README.md` | 只在 Active 表加本层计划一行 |
| `docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md` | 控制计划；本层按 `Global Constraints` 的文件集合改它的 Batch L1 步骤、`Progress`、验收表第 1 项与栈级收口段落 |

## Design / Spec

### D1. 本层判定的对象是行为 6 的**后半句**

行为 6 是「结果不确定的外部创建先对账再重试，**且不盲目重试**」。E1-3 已实测前半句在「加入既有内容」这一步成立（`(project, content)` 幂等、计数 1）；没有实测的是后半句的前提：**创建内容本身**时，重复创建会不会产生重复对象，以及响应丢失后能不能靠对账唯一认出自己写的那条。

因此四条实验全部围绕「创建内容本身」设计：`createIssue`（issue #119 点名的分支）与 `addProjectV2DraftIssue`（draft 分支）。

### D2. 实验 ① 必须用**逐字相同**的参数

「盲重试」的定义就是"参数完全相同地再发一次"。若两次参数不同（例如标题带序号），计数为 2 只能说明"标题不同就是两条对象"，不能说明盲重试的后果。因此实验 ① 的两次 `createIssue` 标题与正文逐字相同，只有墙钟时间不同。

判据：按标题精确过滤的对象计数为 1 → 平台去重，盲重试安全；为 2 → 平台不去重，盲重试制造无法检测的重复。

### D3. 对账查询用「标记 + 作者 + 时间窗」，并且**同时**跑两条查询路径

实验 ② 的对账查询形状由控制计划给定：标记（标题里的唯一串）+ 作者 + 创建时间窗。本层把它落成两条独立路径，因为两者的可见延迟不同，而"用哪条查询对账"是 L3/L4 要落地的决定：

| 路径 | 命令 | 性质 |
|---|---|---|
| 搜索索引 | `gh search issues` | 平台搜索索引，可能有索引延迟 |
| 仓库侧列表 | `gh issue list --state all` | 仓库资源直读，不经搜索索引 |

两条路径都按同一标记过滤；**计数不一致本身就是观测结果**。

### D4. 实验 ③ 的失败必须是**平台显式拒绝**，不是"查询没查到"

"对账查不到就允许重试"这条规则只有在"写入确实没发生"时才安全。因此实验 ③ 用一次平台显式拒绝的创建，然后**在同一条对账查询**里确认计数为 0。**Superseded by 实验 ③ 实测（2026-09-23）**：原文写「`--label` 指向不存在的标签 → `422`」，实测 `gh issue create --label` 是**客户端**拒绝（`could not add label: … not found`，无 HTTP 响应），走 REST 才拿到 `201` 并自动建标签；拿到 `422` 的是 `--assignees`。命令形状见下方「实验的固定命令形状」的订正。这样"计数 0"的两种成因（写入失败 / 写入成功但还没可见）在实验 ② 与实验 ③ 里被分开观测——这是本层最重要的判别性设计。

### D5. 实验 ④ 记录 draft 的对账**作用域**

draft 没有仓库侧列表：它不是 issue，`gh issue list` 与 `gh search issues` 都看不到它。因此 draft 的对账作用域只能是 project 的条目连接。本层记录三件事：① 该作用域能不能按标题唯一认出刚创建的 draft；② 它的可见延迟；③ 仓库侧两条路径确实查不到它（证明作用域是被平台限制的，不是实现选择）。

### D6. 状态集只写有观测支持的取值

控制计划的第 ⑤ 步要求「推不出的取值不写进 R8」。因此本层的状态集按下列规则产出：每个候选取值必须指到**至少一条观测编号**，指不到的一律不写，并把它列进「未证明的部分」。推导不引入任何平台未返回的字段。

### D7. 夹具归本层所有，既有夹具只读

沙箱定义 §1 规定"一个批次只写自己的夹具"。本层新建的夹具全部带标记 `uncertain-create`，在沙箱定义 §2.3 里占一行（归属 #119）。既有夹具（issue-alpha、draft-beta、pr-gamma、issue-shared、draft-convert、issue-writable、issue-dupe）只读。**绝不在 `SingularityKChen/harness-projects` 或其看板上造任何夹具。**

### 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 用网络故障（断网、代理超时）模拟响应丢失 | 不可复现、不可控，且失败原因不可归因；丢弃 stdout 得到的是同一个信息状态（调用方拿不到响应体），而写入确实发生了 |
| 只用 `gh search issues` 做对账 | 搜索索引有延迟，会把"还没被索引"误读成"不存在"；必须与仓库侧列表对照 |
| 用两次参数不同的创建测"重复" | 见 D2：参数不同时计数为 2 是必然的，没有判别力 |
| 用"不存在的仓库"做实验 ③ 的失败 | 该失败发生在解析仓库阶段，对账查询的作用域与它不同，计数 0 不能证明"写入未发生" |
| 让 draft 也走 `gh issue list` 对账 | 平台不支持；应当记录成"作用域被平台限制"，而不是伪造一条查询 |
| 把状态集按 ADR-0004 的三条直接抄进 R8 | ADR-0004 的第 3 条自述是推导结论；本层的职责正是给它补观测或明确保持开口 |

## Global Constraints

- **文件所有权（本层只改这些）**：`docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md`（本文件）、`docs/architecture/gate-e1-uncertain-create.md`、`docs/architecture/gate-e1-sandbox.md`（§2.3 夹具表、§3 创建步骤、§6 记录模板）、`docs/architecture/gate-e1-ruling.md`（§2.6 与 §4 的 R8 行，外加 §2 汇总表第 6 行、§3 第 1 项、§8 第 1 项这三处**同一事实的派生表述**，理由见 `Decision Log`）、`docs/README.md`、`docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`（Batch L1 的步骤与验证、`Progress`、验收表第 1 项）、`docs/exec-plan/completed/2026-09-21-gate-e1-ruling.md`（`Outcomes` 的两处）、`docs/adr/ADR-0004-unknown-external-create-is-product-visible.md`、`docs/adr/README.md`、`docs/project-management/merge-queue.md`（§4.4 的自动 retarget 实测、§4.5 的栈链接实测、§4.6 的 `size` 基线实测、§7 的两处）、`docs/architecture/README.md`（本层记录进索引）、`docs/review/2026-09-24-pr-121-mmp-round3.md`（本层评审记录的归档）、`tests/contract/e1-evidence-consistency.test.js`、`tests/contract/plan-facts-consistency.test.js`。**2026-09-24 评审订正**：这份清单是「本层改了哪些文件」的**唯一权威**（控制计划的所有权表已删、改口指向这里），因此必须与实际 diff 逐一相等；上一版漏了 `docs/architecture/README.md` 与评审记录，并把 `merge-queue.md` 的改动误写成「§7 的两处」。
- **只读**：`packages/**`、`docs/architecture/gate-e1-content-identities.md`、`...-membership-and-draft.md`、`...-write-and-events.md`、其它 `docs/architecture/**`、其它工作树。
- **2026-09-23 复核轮由人类伙伴显式扩大授权**：上面从控制计划起的三份文档、`docs/adr/**`、`docs/project-management/**` 与 `tests/contract/e1-evidence-consistency.test.js` 原先都在"只读"里；第一轮复核的发现要求改的正是这些文件（同一事实的全部落点、ADR 的证据边界、契约测试的粒度），因此按用户指令把它们移入所有权。`packages/**` 的禁令不变。
- 沙箱写入只落在 `$E1_OWNER/$E1_REPO` 与本层新建的 draft 条目上；不写 `SingularityKChen/harness-projects` 及其看板。
- 不 `git push`、不做任何 `gh pr` 写操作、不合并 PR、不改 `main`、**不自行 rebase**（base 变化只报告）。
- 文档变更 ≤1500 行（`node scripts/rule-checks.mjs size <本层真实父提交>`）。
- 不写本机绝对路径、凭据、账号个人信息、内部系统（`docs/development/publication.md`）。命令一律用 `$E1_*` 变量占位，不写死 token。
- 记录里不出现"应该会返回 X"这类补全；平台没返回的字段写"不存在"。

## Plan of Work

### Batch L1 · #119 不确定创建的裁决证据（`Refs #119`：验收 1 的墙钟缺口见 `Decision Log`）

**最小闭环**：行为 6 从 `inconclusive` 变成有证据的裁决，R8 的状态集有出处或明确保持开口。

**涉及文件**：本文件、`docs/architecture/gate-e1-uncertain-create.md`、`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-ruling.md`、`docs/README.md`、`docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`

**步骤**：

- [x] 建立本文件（本层的实验设计、批次、验证命令与回滚点）
- [x] 只读核对沙箱现状与沙箱定义的差异（`fixture shared` 已 `CLOSED`），把差异写进记录而不是改沙箱定义的对象清单
- [x] 执行实验 ① 重复创建：同参数两次 `createIssue`，记录两次返回的对象 id 与按标记的计数
- [x] 执行实验 ② 对账分支 A：一次响应被丢弃的 `createIssue`，按「标记 + 作者 + 时间窗」在两条查询路径上轮询，记录唯一性与可见延迟
- [x] 执行实验 ③ 对账分支 B：一次平台显式拒绝的 `createIssue`，确认同一条对账查询计数为 0
- [x] 执行实验 ④ draft 分支：一次响应被丢弃的 `addProjectV2DraftIssue`，记录对账作用域（project 条目连接）与可见延迟，并确认仓库侧两条路径查不到
- [x] 由 ①–④ 推出**两条轴**（评审响应订正，2026-09-24）：结果轴取 `packages/domain` 的 `WriteState`，获知方式四个标注各指到观测编号
- [x] 写 `docs/architecture/gate-e1-uncertain-create.md`：九字段齐全，每条观测带命令与墙钟时间。**如实登记（2026-09-24 评审）**：记录 `:289` 与 `:309` 自己写明「本条对账自身的墙钟未逐条记录」「本次回读未单独记录」，因此验收 1 的「每条观测」在本层**未字面满足**；处置见 `Decision Log`
- [x] 在沙箱定义 §2.3 夹具表加本层那一行（归属 #119）
- [x] 改裁决 §2.6 的裁决与 §4 的 R8 行，引用本记录
- [x] 在 `docs/README.md` 的 Active 表加本层计划一行
- [x] 控制计划的 `Progress` 与栈级收口回填（评审响应轮已由本层完成，见 `Progress`；原文写「不由本层做、控制计划在本层是只读」，与本文件 `Global Constraints` 的文件集合互相否证，已按当前事实订正）

**实验的固定命令形状**（值见 `docs/architecture/gate-e1-sandbox.md` §2.1；`$E1_L1_RUN` 由记录文件声明为唯一赋值处）：

```bash
E1_OWNER=<见沙箱定义 §2.1>; E1_REPO=e1-sandbox
E1_PROJECT_A=11; E1_PROJECT_A_ID=PVT_kwHOAY1ahM4BkJ9r
E1_L1_RUN=<本次运行第一次创建前的 UTC 时刻，形如 20260923T0345Z>

# ① 同参数两次创建
gh issue create --repo "$E1_OWNER/$E1_REPO" \
  --title "fixture uncertain-create duplicate $E1_L1_RUN" \
  --body "Gate E1 fixture. Uncertain-create duplicate probe (#119)."
# （逐字再执行一次）
# 计数：仓库侧列表按标题精确过滤
gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 \
  --json number,title,author,createdAt,id \
  | jq --arg t "fixture uncertain-create duplicate $E1_L1_RUN" \
       '[.[] | select(.title == $t)] | {count: length, items: .}'

# ② 响应被丢弃的创建（调用方拿不到响应体）
gh issue create --repo "$E1_OWNER/$E1_REPO" \
  --title "fixture uncertain-create reconcile $E1_L1_RUN" \
  --body "Gate E1 fixture. Uncertain-create reconcile probe (#119)." > /dev/null 2>&1
echo "exit=$?"
# 对账轮询：搜索索引路径与仓库侧列表路径同时跑
gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" \
  --created ">=$E1_L1_RUN_START" \
  "fixture uncertain-create reconcile $E1_L1_RUN in:title" --json number,title,createdAt
gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 \
  --json number,title,author,createdAt,id

# ③ 平台显式拒绝的创建
gh issue create --repo "$E1_OWNER/$E1_REPO" \
  --title "fixture uncertain-create failed $E1_L1_RUN" \
  --label "e1-label-that-does-not-exist" \
  --body "Gate E1 fixture. Uncertain-create failure probe (#119)."
# 随后跑与 ② 同形的对账查询，期望计数 0
# Superseded by 实验 ③ 实测（2026-09-23）：上面这个形状在客户端就被拒绝，拿不到平台 422。
# 要取得平台显式拒绝，用记录实验 3 §3 的 REST 调用 + 不存在的 --assignees（详见 `docs/architecture/gate-e1-uncertain-create.md`）。

# ④ 响应被丢弃的 draft 创建
gh project item-create "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --title "fixture uncertain-create draft $E1_L1_RUN" \
  --body "Gate E1 fixture draft. Uncertain-create reconcile probe (#119)." \
  --format json > /dev/null 2>&1
echo "exit=$?"
# 对账：project 条目连接（draft 没有仓库侧列表）
gh api graphql -f query='
query($project: ID!) {
  node(id: $project) { ... on ProjectV2 {
    items(first: 20) { totalCount nodes {
      id type createdAt creator { login }
      content { __typename ... on DraftIssue { id title } } } } } }
}' -f project="$E1_PROJECT_A_ID"
```

**验证**：

```bash
# 在检出 test/e1-uncertain-create 的工作树根目录运行
python3 - <<'PY'
from pathlib import Path
text = Path('docs/architecture/gate-e1-uncertain-create.md').read_text()
fields = ['实验编号与目的', '夹具', '请求', '观测', '本地应有行', '意外行为', '决策影响', '判定', '复现']
missing = [f for f in fields if f not in text]
assert not missing, missing
print('九字段模板：齐全')
PY
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
node --test tests/contract/e1-evidence-consistency.test.js   # 本层的记录会被这份契约测试读取
```

期望：九字段脚本打印「九字段模板：齐全」；`disclosure origin/main` 与 `size origin/main` 退出码 0；两条 `git diff --check` 无输出；一致性契约测试 `fail 0`（本层新增的记录满足「每个 id 字面量都能在沙箱定义里找到」与「每节实验都有一条『规划字段值』行」两条不变量）。

**体量口径（只有一套）**：`size origin/main` = **本层自己的体量**（本分支已级联到 `main` 尖端）。**Superseded by 级联（2026-09-24 评审响应）**：本节原先还要求报一条 `size a48ccae`，但 `a48ccae` 只挂在已删除的远端 `backup/*` 上——在全新 clone 里 `git cat-file -t a48ccae` 报 `fatal: Not a valid object name`，命令与 `git diff --check a48ccae...HEAD` 都不可复跑（`PLANS.md` §4「可执行」）。那条命令已删除；假超限的机制与操作结论记在 `docs/project-management/merge-queue.md` §4.6，不在这里复述。
- **Superseded by 级联（2026-09-23）**：本节原文（观察时刻快照、已不可复跑）写"`size a48ccae` 是真实父提交、判据用这一套；本层不自行 rebase，级联由收尾批次统一执行"——级联已在本层完成（`git reflog` 的 `rebase (start): checkout origin/main`），父提交口径随之改为 `origin/main`。
- 控制计划原文写的 `size origin/test/e1-ruling` 已不可用：该分支随 PR #108 合并被删除（`git fetch --prune` 后本地 ref 也没了），命令报 `fatal: Not a valid object name origin/test/e1-ruling`。这一条如实记录，不改控制计划的验证块（它是 L0 的历史表述）。

**回滚**：`git revert` 本层提交。本层只动文档，回滚后裁决回到「行为 6 待补证据」的状态；沙箱里新建的夹具不影响仓库（§5 的拆除步骤与夹具无关）。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 记录九字段齐全且顺序与沙箱定义 §6 一致 | 九字段脚本 + 人工核对顺序 | 通过（2026-09-23：脚本打印「九字段模板：齐全」；四节实验都按 §6 的 1–9 顺序） |
| 2 | 实验 ① 给出同参数两次创建的对象计数 | 记录 §1 字段 4 的两条响应原文与计数查询 | 通过（记录实验 1 §4：计数查询返回 `{"count":2,…}`，`#7` / `#8` 两个不同 node id） |
| 3 | 实验 ② 给出对账唯一性与两条路径的可见延迟 | 记录 §2 字段 4 的轮询原文 | 通过（记录实验 2 §4：第 3 轮两条路径各 1 命中；仓库侧列表 ≈0 s、搜索索引 ≈9 s） |
| 4 | 实验 ③ 给出「平台显式拒绝后对账为空」 | 记录 §3 字段 4 的 `422` 原文与计数 0 | 通过（记录实验 3 §4(c)：`422` + 两条路径 0 命中 + 仓库全量编号集合无新增） |
| 5 | 实验 ④ 给出 draft 的对账作用域与可见延迟 | 记录 §4 字段 4 的条目连接原文与仓库侧空结果 | 通过（记录实验 4 §4：条目连接唯一命中、≈4 s；仓库侧列表与搜索都是 0 命中） |
| 6 | 状态集每个取值都指到观测编号，推不出的取值不写入 | 记录 §2 的两条轴与观测支持表 | 通过（记录 §2：结果轴取 `WriteState`，获知方式四个标注各指到观测，5 个候选逐条点名不写入）。**评审响应订正（2026-09-24）**：原写"4 个取值、`pending` 与 `uncertain` 不可判别已合并"——那是把结果轴与获知方式轴装进同一个集合的后果；现按两条轴表述，`pending` 由本地写入记录判定，见记录 §2 的订正说明 |
| 7 | 裁决 §2.6 与 §4 的 R8 行引用本记录 | 读 `docs/architecture/gate-e1-ruling.md` | 通过（裁决 §2.6 的「该空白已由 L1 补测」段与 §4 的 R8 行都引用本记录；**评审响应订正（2026-09-24）**：R8 行改为「类型取 `WriteState` + 获知方式四标注」，并撤掉了原先指向 L3 的 `Superseded by` 注记——那一条属于 L3 的 diff） |
| 8 | 沙箱定义 §2.3 只有本层新增的一行夹具 | `git diff origin/main...HEAD -- docs/architecture/gate-e1-sandbox.md`（**订正 2026-09-24**：原用 `a48ccae`，该提交只挂在已删除的 `backup/*` 上，全新 clone 里不可解析） | 通过（`git diff origin/main...HEAD` 实测本层在 §2.3 新增 2 行：`uncertain-create 系列` 与仓库级对象 `label-auto-created`；后者是复核时补登记的） |
| 9 | 发布面合规与体量 | `disclosure origin/main`、`size origin/main`、`git diff --check` | 通过（复核实测：`disclosure origin/main` exit 0；`size origin/main` exit 0、文档 1407 / 1500；`git diff --check origin/main...HEAD` 无输出） |

## Progress

- [x] (2026-09-23) 读控制计划 Batch L1 / D3 / D9 / D10 / Global Constraints、沙箱定义 §1/§2.3/§5/§6、裁决 §2.6 与 §4 的 R8、E1-3 记录、`PLANS.md`
- [x] (2026-09-23) 核对沙箱现状（5 条 issue、Project A 7 个条目、`fixture shared` 为 `CLOSED`）与 base 漂移
- [x] (2026-09-23) 建立本文件
- [x] (2026-09-23) 实验 ①–④、记录、三处引用与验证全部完成。体量是易失值，回读命令：`node scripts/rule-checks.mjs size origin/main`
- [x] (2026-09-23) 复核轮（人类伙伴授权的文件集合）：把 `pending` 合并进 `uncertain`（4 个取值）并改到同一事实的全部落点；订正实验 4 的「规划字段值」计数 0 → 1（含实验 1–4 的逐条复核）；补 §3 的三条证据边界；收宽 `failed` 的定义；补观测命令与时间；登记仓库级对象 `e1-label-that-does-not-exist`；订正 ADR-0004 的证据边界与 5 处「行为 6 仍 inconclusive」的表述；契约测试改成每节实验粒度并把「0 个用户可写字段值」写成可解析形式（两次变异实验：计数改 99 → 变红、删掉一节的行 → 变红，还原后 3 pass / 0 fail）
- [x] (2026-09-23) 第三轮（评审 9 条）：契约测试的每节守卫改为标题级别不敏感 + 级别断言、新增架构索引守卫；记录 §2 补产品可见性条件；本文件登记豁免的收口条件；控制计划按实测订正栈底与体量口径；`merge-queue.md` §4.6 的 `size` 表按 head 重测并订正方向、§4.5/§4.4 补自动 retarget 实测
- [x] (2026-09-24) **评审响应轮（11 条，按根因修）**：① 撤掉栈底对 L2–L6 的交付断言与裁决里 R4/L5、R8/L3 两处上层注记——栈必须自下而上合并，本层只能写本层合并时为真的事实；② R8 从「一条混合集合」改成**两条正交轴**（结果轴取 `packages/domain` 的 `WriteState`，L1 的四个取值降为获知方式标注并改名 `failed`→`rejected`、`uncertain`→`unresolved`），修掉「R8 同一行两套答案」与「`pending` 不可判别」的伪约束；③ 控制计划的栈序表与验收表从「写死的 SHA 与逐层结论」改成「回读命令 + 期望」；④ 证据守卫从「宽松正则发现 + 跨文档下限」改成**逐文档声明式清单**（改名 / 降级 / 升级 / 删节 / 加节 / 未登记新文档全部响亮失败，六个变异逐个实测红绿）；⑤ 记录 §3 补登三条漏项（结果未知且对象不存在、GraphQL `errors[]` 协议、`Status = Todo` 的创建归因），并把搜索路径从对账证据里剔除；⑥ `merge-queue.md` §4.6 那一格的 exit 码按脚本逻辑订正为 0；⑦ 行为 6 的改判行补「采纳权在人类伙伴」。逐条处置见 **PR #122** 携带的 `docs/exec-plan/completed/2026-09-24-review-root-cause-convergence.md`（该文件随 L2 合入，因此本层只写 PR 引用、不写路径——`AGENTS.md` §3 要求 `docs/` 自包含）

- [x] (2026-09-24) **第四轮评审响应（15 条）**：① 控制计划删除属于上层的副本（空节、空表、「目标表 → 端口方法映射」），`Closes` 列与六个 Batch 标题不再写死关闭关系；② 本文件与本层记录里指向 L2 才有的文件的两处指针改成 PR 引用；③ 证据指针从"提交正文"改成 PR 描述与 `Outcomes`（重组后提交正文为空）；④ 不可解析的 SHA 与分支名基线按 `PLANS.md` §4 就地标注或改成回读命令；⑤ 验收 1 的墙钟缺口如实登记，两条出路写进 `Decision Log`（人类伙伴决定）；⑥ 文件所有权清单补齐到与实际 diff 逐一相等；⑦ 证据守卫的两个逃逸收口（引号 / `export` / 缩进绕过的行首绑定、沙箱绑定进 `localNamesById`）。逐条判定见 **PR #122** 携带的 `2026-09-24-review-root-cause-convergence.md`。

## Surprises & Discoveries

- (2026-09-23) **声明的 base 被第三方重写并删除**：`origin/test/e1-ruling` 一度是 `5497bf7`（重写后的 L0），而本分支的父提交是 `a48ccae`（重写前的 L0），两者内容差 4 行；PR #108 于 2026-09-23T03:37:49Z 合并后该分支被删除，`main` 尖端是 `4d46559`。后果：`git merge-base HEAD origin/main` 退到旧 `main` 尖端，三点 diff 把 L0 的 1255 行算进本层体量。证据：`git rev-list --left-right --count origin/main...HEAD`、`git diff --stat 5497bf7 a48ccae`。处理：不自行 rebase，两套口径都报（见 `Plan of Work`）。

- (2026-09-23) **"非法参数"不必然导致平台拒绝**：实验 ③ 的第一版设计用"不存在的标签"制造失败，实测 `gh issue create --label` 在**客户端**拒绝（`could not add label: '…' not found`，exit 1），而同一个标签经 REST 提交时平台返回 `201` 并**自动创建该标签**。证据：`docs/architecture/gate-e1-uncertain-create.md` 实验 3 §4 的 (a)/(b) 两段原文，以及 `gh label list` 里该标签的 `createdAt`。处理：改用不存在的 `assignees` 取得真正的 `422`；两次意外成功的探针产生的对象按夹具保留、不删除。

- (2026-09-23) **对账查询的两条路径可见延迟差一个量级**：实验 ② 里仓库侧列表在命令返回的同一秒命中，搜索索引要 ≈9 s；窗口内搜索路径返回 0 而对象已存在。这条否掉了"对账为空就重试"的规则，直接进入状态设计（**评审响应订正，2026-09-24**：原文写"`pending` 与 `uncertain` 的分界"——分界不在结果轴上，而在**允许的对账路径**上：搜索路径不是对账证据，因此这条观测支持的是"搜索路径不可用"，不是"允许路径给不出结论"；见记录 §2.2）。证据：记录实验 2 §4 的三轮轮询原文。

## Decision Log

- **Decision**：用「丢弃 stdout」模拟响应丢失，不制造网络故障。
  **Rationale**：两种做法给调用方的是同一个信息状态（拿不到响应体），而丢弃 stdout 可复现、可归因；网络故障不可控，且无法区分"写入未发生"与"响应丢失"。
  **Date/Author**：2026-09-23 / agent

- **Decision**：对账同时跑搜索索引与仓库侧列表两条路径。
  **Rationale**：两者的可见延迟不同，而"用哪条查询对账"是 L3/L4 要落地的决定；只跑一条会把索引延迟误读成对象不存在。
  **Date/Author**：2026-09-23 / agent

- **Decision**：实验 ③ 用平台显式拒绝（`422`）而不是"查询没查到"来代表"写入未发生"。
  **Rationale**：实验 ② 会观测到"对象已存在但对账暂时查不到"，所以"计数 0"本身不足以推出"可以重试"；只有"平台显式拒绝 + 计数 0"才是安全的可重试条件。
  **Date/Author**：2026-09-23 / agent

- **Decision**：状态集只写有观测支持的取值，推不出的列进「未证明的部分」。
  **Rationale**：控制计划第 ⑤ 步与 R8 的「补证据前不得冻结状态集」；ADR-0004 的第 3 条自述是推导结论，本层的职责是给它补观测或明确保持开口。
  **Date/Author**：2026-09-23 / agent

- **Decision**：裁决文件除 §2.6 与 §4 的 R8 行之外，另改三处**同一事实的派生表述**（§2 汇总表第 6 行、§3 第 1 项、§8 第 1 项）。
  **Rationale**：任务边界写的是"只改 §2.6 与 §4 的 R8 行"，但行为 6 的取值在同一份文件里被写了四处；只改两处会让文档自证相反（§2 汇总表仍写 `inconclusive`，§3 仍写"五条 pass"），违反 `PLANS.md` §4 的「被推翻的结论就地标注」与 `AGENTS.md` §5 的「发现事实推翻假设时更新下一道门」。三处改动都是单行、机械、可逐字回滚，并已在 `Bottom Change Note` 与 PR 描述里点名。**2026-09-24 评审订正**：原文写「提交正文」——本层重组后的提交正文为空，证据指针不能指向易失载体。
  **Date/Author**：2026-09-23 / agent

- **Decision**：#119 的验收 1 在本层**未字面满足**（两处观测缺逐条墙钟与确切命令）；两条出路都属人类伙伴的决定，本层只把入口摆出来。
  **Rationale**：验收 1 的字面要求是"每条观测带墙钟时间与确切命令"；记录 `:289` / `:309` 自己承认 3(a) 的对账与标签回读没有逐条记录。出路①**补观测**：3(a) 的失败创建不产生对象，换一个标记即可重跑，标签回读是只读查询（成本低，但会新增沙箱对象、需要人类确认沙箱仍在）；出路②**收窄验收 1**：由人类伙伴在 #119 上写明"墙钟只要求逐实验、不要求逐观测"。在任一出路被选定之前，本层按 `Refs #119` 交付，`Closes` 的唯一权威是 PR 的 `closingIssuesReferences` 回读。
  **Date/Author**：2026-09-24 / agent（第四轮评审响应）

- **Decision**：控制计划的 `Progress` 回填不在本层做。
  **Rationale**：任务边界是"只改三处引用"；控制计划由并行层与级联执行者共用，本层不写它可减少争用。本层的完成状态写在本文件的 `Progress` 里。
  **Date/Author**：2026-09-23 / agent
  **Superseded by 复核轮（2026-09-23）**：该决定让控制计划 Batch L1 的步骤复选框与验收表长期停在"未勾 / 待验证"，与两处 `Progress` 的"已完成"互相否证；复核轮已按实测回填，本层对该文件的写入由人类伙伴显式授权。

- **Decision**：把 `pending` 合并进 `uncertain`，状态取值集合从 5 个改为 4 个。
  **Rationale**：复核发现两者由**同一条**「窗口内为空」观测支持，而被引作 `pending` 证据的 `03:41:16Z` 那一秒仓库侧列表路径已经唯一命中（实验 2 §4 第 1 轮 `list_hits=1`）——"对账尚未给出结论"在记录自己的观测里就不成立。按 §2 自己的规则（推不出独立支持的取值不写入），保留两个取值等于把一个不可判别的取值写进 R8。选①（为 `pending` 补观测）需要一条本层没有做的新实验，而沙箱的四条实验已经结束、重跑会制造新对象并让计数失去意义，因此取②合并，并把判别性缺口逐条写进记录 §3 第 12 条。
  **Date/Author**：2026-09-23 / agent（复核轮）
  **Superseded by 评审响应（2026-09-24）**：本决定的前提是把结果轴与获知方式轴装进同一个集合——在**一条**轴上，"本地生命周期阶段"当然竞争不过"有平台观测的取值"。按两条轴重判（记录 §2 的订正说明）：`pending` 是结果轴上的合法取值，由本地写入记录判定，不需要平台观测；本层的观测只对获知方式负责。因此状态列的**类型**取 `packages/domain` 的 `WriteState`，L1 的四个取值降为获知方式标注并改名（`failed`→`rejected`、`uncertain`→`unresolved`）以避免两轴同名。原文保留以记录当时的推理。

- **Decision**：契约测试的「规划字段值」核对改成**每节实验**粒度，「0 个用户可写字段值」写成可解析形式（`只有 0 个用户可写规划字段值`），且缺枚举时响亮失败而不是跳过。
  **Rationale**：复核实测把实验 4 的计数改成 99 时三条测试全绿——(b0) 的粒度是每份记录，而数字核对在缺「只有 … 可写」枚举时直接 `continue`。改完后两次变异（计数改 99、删掉实验 1 的整行）都变红。E1-3 记录只在实验 1 给了该行，补行要动已合并的记录（不在本层所有权内），因此 `PLANNING_ROW_EXEMPT` 增一条**精确到节**的豁免（实验 2、3），而不是整份豁免。
  **Date/Author**：2026-09-23 / agent（复核轮）

## Idempotence and Recovery

- 四条实验的读查询全部只读且可重复；写操作（三次 `createIssue`、一次 `addProjectV2DraftIssue`）各只执行一次，重跑会产生新的夹具对象并让实验 ① 的计数失去意义——**重跑必须换新的 `$E1_L1_RUN`**。
- 实验 ③ 的失败创建不产生对象，可以任意重跑（每次都要换标记以保持"按标记计数"的判别力）。
- 夹具不删除：实验 ① 的计数 2 本身就是证据，删掉它第三方就无法复核。拆除按沙箱定义 §5 整仓删除。
- 记录文件里的历史观测值不因后续变化改写；后续变化写成旁注（沿用 E1-3 记录 §4.6 的做法）。
- 若发现 base 再次变化：只报告，不自行 rebase（`Global Constraints`）。

## Interfaces and Dependencies

- `gh` CLI 已登录 `$E1_OWNER`，token 作用域含 `repo` 与 `project`（`gh auth status`）；记录里不出现 token。
- 沙箱：私有仓库 `$E1_OWNER/$E1_REPO`（node id `R_kgDOUjWAlw`）、Project A `11`（node id `PVT_kwHOAY1ahM4BkJ9r`）。
- 依赖的既有决策：`docs/architecture/gate-e1-ruling.md` §4 的 R8；`docs/adr/ADR-0004-unknown-external-create-is-product-visible.md`。
- 依赖的记录模板：`docs/architecture/gate-e1-sandbox.md` §6 的九字段与三条填写纪律。
- 本层对内提供的接口：**获知方式**四个标注 `confirmed` / `reconciled` / `rejected` / `unresolved` 及其到 `WriteState` 结果轴的映射（R8 的落地层建表时消费），以及记录文件的九字段结构（可被 `tests/contract/e1-evidence-consistency.test.js` 的一致性断言读取）。

## Outcomes & Retrospective

四条实验全部完成，观测窗口 `2026-09-23T03:40:54Z`–`03:44:04Z`，平台原文与墙钟时间都在 `docs/architecture/gate-e1-uncertain-create.md` 里。

| 项 | 实测值 |
|---|---|
| 实验 ① 同参数两次 `createIssue` 的对象计数 | **2**（`#7` / `#8`，两个不同 node id）——平台不对内容创建去重 |
| 实验 ② 对账分支 A | 两条路径**各唯一命中 1 条**；可见延迟：仓库侧列表 **≈0 s**、搜索索引 **≈9 s**；窗口内搜索路径返回 0 而对象已存在 |
| 实验 ③ 对账分支 B | 平台显式拒绝 `422`（非法 `assignees`）后两条路径对账**都是 0**，仓库编号集合无新增；重试后按标记计数 **1** |
| 实验 ④ draft 分支 | 对账作用域**只有 project 条目连接**（仓库侧列表与搜索都是 0）；可见延迟 **≈4 s** |
| 状态 | **两条轴**（评审响应订正，2026-09-24）：结果轴取 `packages/domain` 的 `WriteState`；获知方式四个标注 `confirmed` / `reconciled` / `rejected` / `unresolved` 各指到观测；5 个候选取值因推不出支持而不写入。原文写"4 个取值（含复核时合并掉的 `pending`）"，见记录 §2 的订正说明 |
| 未证明的部分 | 18 条，逐条点名在记录 §3（评审响应补登第 15–18 条） |
| 体量（`origin/main` 口径，判据用这一套） | `node scripts/rule-checks.mjs size origin/main`：期望 exit 0、文档 ≤1500 行（本分支已级联，`origin/main` 是本分支的祖先）。复核实测 **1407 / 1500，exit 0**（行数是本文件的函数，属易失值，回读为准） |
| 体量（`a48ccae` 口径，观察时刻快照、不可复跑） | `node scripts/rule-checks.mjs size a48ccae`：**期望 exit 3**——`a48ccae` 只挂在已删除的 backup 分支上，脚本对解析不了的 base 报 exit 3。原文写「期望 exit 1，是假超限」，那是它当时还是祖先时的行为。**Superseded by 级联（2026-09-23）**，且原文把这一套当"真实父提交口径、判据用这一套" |
| 控制计划原文口径 | `node scripts/rule-checks.mjs size origin/test/e1-ruling` → exit 3（`Not a valid object name`）：该分支随 PR #108 合并被删除 |

上表的体量不写具体数字：它是本文件自己的函数（改本文件就会变），按 `PLANS.md` §4 写成"回读命令 + 期望"。定稿时的实测值写在 **PR 描述**与 `Outcomes & Retrospective` 里——2026-09-24 评审订正：原文写「提交正文」，而本层重组后的提交正文为空，指向了一个不存在的载体。

**与计划的偏差**：两处。① 实验 ③ 的第一版设计（不存在的标签）没有产生平台拒绝，反而暴露了"REST 会自动创建未知标签"这条平台行为，改用不存在的 `assignees` 才拿到 `422`；② 实验 ④ 的第一条 draft 因本层的工具错误没有测到延迟，改用第二条重新计时。两处都写进了记录的「意外行为」，没有掩盖。

### 遗留问题与技术债务

- **`PLANNING_ROW_EXEMPT` 对 `docs/architecture/gate-e1-write-and-events.md` 的 `[2, 3]` 豁免没有收口条件**（登记 2026-09-23；强制点在 `tests/contract/e1-evidence-consistency.test.js`）。豁免理由是"补齐要改已合并的 E1-3 记录，不在本层所有权内"，属于范围外的临时豁免，因此必须可回收。**收口条件**：那份记录实验 2、3 的小节补上「只有 … 可写」枚举（或补「规划字段值」行）后，删掉该豁免项，并确认契约测试仍 `fail 0`。豁免存在期间它是唯一一条"记录缺行而测试不报"的路径，因此不得扩大（整份豁免、通配或新增豁免节都要在测试里显式列出并重述理由）。

## Bottom Change Note

- 2026-09-23：首次创建。原因：控制计划 D9 要求每层自带 ExecPlan；本层是 Batch L1（#119），交付行为 6 的证据与 R8 的状态集。
- 2026-09-23：执行后回填（四处：控制计划改只读、验证块改口径、`Surprises` 补三条实测、`Decision Log` 补三条并填 `Outcomes`）。
- 2026-09-23：复核轮（对抗验证的 12 条发现）。改动六处：① 状态集 5 → 4 个取值（`pending` 合并进 `uncertain`），并改到证据记录 §2/§3/§4、裁决 §2.6 与 §4 的 R8、控制计划与 `docs/README.md` 的全部落点；② 实验 4 的「规划字段值」计数 0 → 1（依据：`2026-09-23T04:16:27Z` 的只读回读实测两条 draft 各带 `Status` = `Todo`），并逐条复核实验 1–4 的口径；③ 记录 §3 补三条证据边界（`pending`/`uncertain` 判别性缺口、"不去重"只有一对 `createIssue`、"可重试"只有一次 422 + 一次重试），§2 的 `failed` 定义收宽到两类拒绝、`confirmed` 的支持列改指带 `node_id` 的响应；④ 补齐观测命令与时间（`gh label list` 回读、仓库全量编号集合、两条轮询包装脚本、未记录的墙钟如实标注上下界），并把"分钟级"改成实测 ≈9 s；⑤ 登记仓库级对象 `e1-label-that-does-not-exist`（沙箱定义 §2.3 + 重建步骤 + 记录夹具表）；⑥ 订正 ADR-0004 的证据边界与索引行、`docs/README.md` / 控制计划 / 归档计划 / `merge-queue.md` 的 5 处"行为 6 仍 `inconclusive`"，并按 `PLANS.md` §4 就地标注。契约测试改成每节实验粒度 + 零值可解析 + 缺枚举响亮失败，两次变异实验都变红、还原后 3 pass / 0 fail。
- 2026-09-24：第四轮评审响应（15 条）。改动七处：① 控制计划删副本、`Closes` 改回读；② 两处指向 L2 才有的文件的指针改成 PR 引用；③ 证据指针从提交正文改成 PR 描述与 `Outcomes`；④ 不可解析 SHA 与分支名基线就地标注或改回读命令；⑤ 验收 1 的墙钟缺口如实登记 + 两条出路进 `Decision Log`；⑥ 文件所有权清单补齐；⑦ 证据守卫的两个逃逸收口。原因：第四轮评审在**当前 head** 上复跑反例，发现第三轮的处置表有相当一部分没有落地；根因是"同一事实多处落点 + 没有机械判据"，本轮按"删副本 + 加判据"处理。
- 2026-09-23：第三轮评审 9 条：契约测试的每节守卫改标题级别不敏感、补架构索引守卫、记录 §2 补产品可见性条件、控制计划按实测订正栈底与体量口径、`merge-queue.md` §4.6 重测并订正方向。
- 2026-09-26：第五轮 MMP 评审无 P0 / P1，评审者就地修复后归档：两条守卫按 GitHub 关闭关键字表与三种路径写法判定、裁决 §9 补 #119 验收 1 的待决项并接回被拆开的句子、文件清单与回滚说明补上 `tests/contract/plan-facts-consistency.test.js`；#119 保持开启。
