# SQLite v1 栈 MMP 交付评审（第三轮 · 跨层记录）

> 状态：Blocked（5 × P1，分布在 #121、#122 ×2、#157、#167；本轮一个都不合并）
> 评审日期：2026-09-24（Asia/Shanghai）
> 范围：#121 → #122 → #157 → #167 → #170 → #175（GitHub 原生 stack，栈号 109，位置 5–10）
> GitHub review：#121 `5300230156` · #122 `5300230688` · #157 `5300231409` · #167 `5300232026` · #170 `5300232346` · #175 `5300232826`（共 74 条 inline）
> 逐 PR 记录：各层 worktree 的 `docs/review/2026-09-24-pr-<n>-mmp-round3.md`
> 本记录由评审者写在 `.worktrees/w13-l6`（栈顶，六层的事实都在这里存在），**已随 #175 的第四轮修复提交**；锁定事实保留第三轮的观察时刻（各层 head/base 见下表），当前 head/base 一律用回读命令取（见「作者响应（第三轮后）」）。

## 1. 锁定事实

| 层 | PR | head | base | Closes | 提交数 | 代码 / 文档（相对声明的 base） |
|---|---|---|---|---|---|---|
| L1 | #121 | `b6e8a16` | `main@484f0d3` | #119 | 9 | 251 / **1486** |
| L2 | #122 | `5f0db7c` | L1 | #27 | 7 | **999** / 1040 |
| L3 | #157 | `d4a8bb9` | L2 | #28 | 5 | 439 / 186 |
| L4 | #167 | `1773f99` | L3 | #163 | 7 | **1000** / 445 |
| L5 | #170 | `fc4dd90` | L4 | #164 | 2 | 828 / 606 |
| L6 | #175 | `e3586e6` | L5 | #5、#120 | 3 | 611 / 440 |

六个 PR 都是 OPEN、`CLEAN`，checks 全绿。上一轮留下的 thread 全部已 resolve；按复评原则，resolve 状态不当作证据，逐条在当前 head 上复跑。提交 review 前又回读了一次六个 head，与上表一致。

## 2. 并集实测（先于逐 PR 评审）

在一次性 clone 里按栈序逐个检出合并点，每个点跑 `pnpm install --frozen-lockfile`、typecheck、`node --test tests/{contract,integration,e2e,mvp0}`、boundaries、`workflow-check`，以及对声明 base 的 `disclosure`、`size` 与 `git diff --check`：

| 合并点 | contract | integration | e2e | mvp0 | 其余 |
|---|---|---|---|---|---|
| `b6e8a16` | 452 / 452 | 5 / 5 | 38 / 38 | 7 / 7 | 全部 exit 0 |
| `5f0db7c` | 464 / 464 | 18 / 18 | 38 / 38 | 7 / 7 | 全部 exit 0 |
| `d4a8bb9` | 465 / 465 | 27 / 27 | 38 / 38 | 7 / 7 | 全部 exit 0 |
| `1773f99` | 486 / 486 | 30 / 30 | 38 / 38 | 7 / 7 | 全部 exit 0 |
| `fc4dd90` | 501 / 501 | 40 / 40 | 38 / 38 | 7 / 7 | 全部 exit 0 |
| `e3586e6` | 514 / 514 | 45 / 45 | 38 / 38 | 7 / 7 | 全部 exit 0 |

**并集层没有 P0。** 没有任何文档宣布数据模型 v1 已冻结或 Gate E1 已通过：裁决 §3 仍是 `revise`，行为 6 的改判写明了待人类伙伴采纳。

## 3. 全栈风险矩阵

| 级别 | #121 | #122 | #157 | #167 | #170 | #175 |
|---|---|---|---|---|---|---|
| P0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **P1** | **1** | **2** | **1** | **1** | 0 | 0 |
| P2 | 4 + PR 级 2 | 9 + PR 级 2 | 7 + PR 级 1 | 3 + PR 级 1 | 4 + PR 级 1 | 4 + PR 级 2 |
| P3 | 9 | 9 | 4 | 5 | 7 | 4 |

## 4. 五条 P1 的独立复现

子评审的阻塞级结论，主控都在自己的 clone 里独立复现后才采信。

**#121：栈底控制计划断言上层事实。**

```text
$ git show b6e8a16:docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md | sed -n 318,322p
- [x] (2026-09-23) Batch L2 · #27 身份与成员表（三张无端口表已按 ADR-0005 删除 …
- [x] (2026-09-23) Batch L3 · #28 执行、关系与写入表 …
- [x] (2026-09-23) Batch L4 · #163 端口机制与地基面 …
- [x] (2026-09-23) Batch L5 · #164 规划同步面（修复轮把观察账本键加宽到含 `dedupe_key`）
- [x] (2026-09-23) Batch L6 · #120 / #5 执行与写入面 + 整端口 …
$ git cat-file -e b6e8a16:docs/adr/ADR-0005-projection-anchor-and-behaviour-2-enforcement.md   → ABSENT
$ git cat-file -e b6e8a16:packages/storage/sqlite/migrations/002_identity_membership.sql       → ABSENT
```

**#122 ①：条目移出 project 再移回后，core 同步永久抛错。** 用 `composeCore` + 内存替身，同一段脚本在三个 head 上各跑一次：

```text
b6e8a16：sync1 ok / sync2（移除）ok / sync3（移回）ok=true projections=5
5f0db7c：sync3 THREW :: projection entity does not exist
e3586e6：sync3 THREW :: projection entity does not exist
```

**#122 ②：`Closes #27`，但验收 3 不成立。** `002:66` 与端口 `:131-133` 把「恰好一个」交给生命周期，理由是「不能声明式表达」。子评审在 `node:sqlite` 上用 `DEFERRABLE INITIALLY DEFERRED` 复合外键表达出了「恰好一个」（零 primary、指向别的实体、删除 primary 三种都被拒），推翻了这个前提。#27 Scope 原文要求 *Constraints that encode the invariants in the database rather than in calling code*。计划 Batch 5 承诺的生命周期断言：`git diff --stat b6e8a16 5f0db7c -- tests/contract/domain-identity.test.js` 输出为空。

**#157：`Closes #28`，但验收 1 在本层不可能成立。**

```text
$ git ls-tree -r --name-only d4a8bb9 packages/storage/sqlite/src
db.ts  index.ts  migrate.ts  migrations.ts        （没有 storage.ts，也就没有端口实现）
$ git grep -n -i "restart\|重启\|reopen" d4a8bb9 -- tests/integration
tests/integration/README.md:10（只有 README 提到，没有用例）
```

**#167：切分契约套件时丢掉了 #163 明令不得放宽的断言。**

```text
d4a8bb9:tests/contract/suites/storage.js:49  '同域旧的默认必须被降级'
d4a8bb9:tests/contract/suites/storage.js:50  '降级只改 isDefault，不改变启用状态'
9642c92 / 1773f99：git grep "降级只改 isDefault" → 0 处
```

子评审的变异结果：把降级改成「降级并禁用」或「直接删除」，现有套件仍 50/50 绿；补回这两条断言后，两个变异各红 1 条。

## 5. 被降级的 P1（理由）

| 原报 | 主控定级 | 理由（可复跑） |
|---|---|---|
| #157 级联后 `binding_id` 作用域从工作区变成连接 | P2 | SQLite 机制复现成立：`sync_cursor` 只剩一行，ws-1 的 `degraded` 被 ws-2 的 `healthy` 覆盖。但用 core + 内存替身在 base `b6e8a16` 上跑同一场景，freshness 同样被覆盖（`A 视图 degraded:false ← B 写的 healthy`），根因是 `main` 上的端口 `SyncCursorRecord` 只按 `bindingId` 取键。今天的宿主每个 provider 实例用随机 `bindingId`，产品路径到不了。根因意见放在 #122 的 ADR-0006 `:50`。 |
| #157 账本键缺 `dedupe_key`，`updated_at NOT NULL` | P2 | 复跑成立，但本层合并点没有代码写 `sync_observation`（SQLite storage 在 L4 才出现，同步面在 L5），剩下的是文档把 L5 的修复写成了已发生。 |
| #175 `Closes #5`，但 core 跑不在 SQLite 上 | P2 | #5 的标题是 schema 与 migration skeleton，#120 明确排除了 core，验收在端口层字面成立，产品接线归 #132。缺口是遗留 5、遗留 18 和第三个阻塞点关闭后没有 issue 承载，已写成合并前必做。 |

## 6. 产品闭环（不把「测试通过」当闭环）

- 整栈合并后，用户和宿主**观察不到任何变化**：`storage-sqlite` 只被测试和根目录的 devDependencies 引用，边界表不允许任何包 import 它。
- 把 core 组合到 `createSqliteStorage` 上：首轮同步整笔回滚（「观察无法挂载」），`composeCore` 吞掉异常，列表为空且没有降级标记；手工预置成员关系后，Start Work 抛裸 `FOREIGN KEY constraint failed`。作者在控制计划里如实写了「某层验收全绿不得读成 SQLite 已能当 core 的 storage」。 **Superseded by L5-H（2026-09-24）**：前半句已不成立——账本主体改成端口主体后，观察不解析落点，首轮同步在 SQLite 上返回 ok（实测 `bootstrapWorkspace()` ok、列表 5 条，与替身逐项相同）；仍成立的是后半句：Start Work 在 SQLite 上抛裸 `FOREIGN KEY constraint failed`（承载 issue #196 / #188 / #187）。原文保留并就地标注。
- R1 推进情况：第 2 条（迁移）从 1 个文件、5 条用例推进到 6 个文件、45 条用例，有了机械证据；第 1 条（Gate E1）仍待人类采纳，而且 R4 键、R8 表名、ADR-0002 观察外键三处偏离只记在层计划里；第 9、10 条没有变化。

## 7. 重新进入排队的条件

1. 按栈序修 P1：#121 的控制计划只写时点事实（或把跨层控制计划拆成独立的 docs PR）；#122 修替身的实体删除语义，并对验收 3 三选一（落进库、人类改写、改 `Refs`）；#157 改 `Refs #28` 并回读 `closingIssuesReferences`；#167 补回两条断言，代码压回 1000 行以内。
2. 合并前必做（P2）：把 core 在 SQLite 上的三个阻塞点开成 issue，设为 #132 的 blocker；六个 PR 的描述按当前 head 刷新（head、计数、提交数、回滚所需的提交数、风险与回滚节）。
3. 提交整理：#121 与 #122 都有「先引入、再撤回」或 fixup 性质的提交。按 `git-expert-operations` 先建 backup ref，整理后级联，每层重新锁定 head、重跑本层验证。
4. 合并机制：栈成员要用 `merge-async` REST 端点（`merge-queue.md` 还没写这一点）；`delete_branch_on_merge=true`，每合并一层，上层都要 `rebase --onto`。#167 与 #121 的体量余量几乎为零。

## 作者响应（第三轮后，2026-09-24）

第四轮评审在栈顶当前 head 上复跑反例后，作者按 §7 的四个条件逐条报告现状：

1. **按栈序修 P1**：**不在本记录的证据范围**——本记录只覆盖栈顶 #175；各层 P1 的第四轮复跑结论见各层 worktree 的 `docs/review/2026-09-24-pr-<n>-mmp-round3.md`。栈顶自身第三轮无 P0 / P1，第四轮又收口三条计划项（执行面读隔离参数化成六个读、写尝试对齐 D5 的幂等覆盖、体量基线改回读式）。
2. **合并前必做（P2）**：core 在 SQLite 上的阻塞点已有 issue 承载——#187（谱系端点）、#188（仓库登记）、#195（仓库外部身份种类）、#196（未登记工作项的结构化失败）；另 #189（workspace-scoped sync facts 的键空间）是多工作区问题，不是 SQLite 专属。把它们设为 #132 的 `blocked-by` **待人类伙伴批准**（`AGENTS.md` §7：`blocked-by` / `blocking` 关系必须有人类批准），agent 不代写；回读 `gh api repos/SingularityKChen/harness-projects/issues/132/dependencies/blocked_by`，当前仍是 #120 / #125 / #126。六个 PR 描述按当前 head 刷新：**未满足**（不在本记录的证据范围，需各层在最终 push 后回读）。
3. **提交整理**：**部分满足**——#175 已按 Batch L6-G 重建（`backup/l6-pre-round3` 锚点）并整理；其余层的整理不在本记录的证据范围。
4. **合并机制**：**未满足**——`merge-queue.md` 还没有记 `merge-async`，`delete_branch_on_merge` 的每层 `rebase --onto` 流程见该文件；不在本记录的证据范围。

**§6 的订正**：第 2 条的前半句「首轮同步整笔回滚、列表为空」已被 L3 / L5 的根因修复取代——实测 `bootstrapWorkspace()` 在 SQLite 上返回 ok、列表 5 条（与替身逐项相同）；Start Work 的裸外键仍然存在（承载 issue #196 / #188 / #187）。原文保留并就地标注 Superseded。
