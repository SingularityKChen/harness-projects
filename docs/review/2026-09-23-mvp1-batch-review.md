# MVP-1 三交付批次（#158–#161）第二轮 MMP 交付评审

> 状态：Completed（评审已提交；#159 → #158 按本记录的处置合并，#160 / #161 本轮不合并）
> 评审日期：2026-09-23（Asia/Shanghai）
> 范围：PR #158、#159、#160、#161——`docs/project-management/merge-queue.md` §4.7 中尚未合并的四个 PR；#162 已于第一轮之后合并，不在本轮
> 评审方式：先锁定 head / base 与既有线程 → 先做并集预演 → 按 PR 分派只读子评审 → 阻塞级结论由主评审独立复现 → 建完 P0–P3 矩阵后一次性提交全部 inline 意见 → 只对"无 P0 / P1"的 PR 就地修复并合并

## Purpose / Big Picture

本轮要回答的不是"测试是否通过"，而是"合并之后，MMP（首发，Gate R1）所需的产品闭环是否真的多成立了一段"。四个 PR 分别落在纵向链路（`docs/product/vertical-path.md` §2）的不同位置：

| PR | 闭环声明 | 纵向链路 / 控制面位置 | issue |
|---|---|---|---|
| #159 | `Engineering` 写入口与观察者共用一份终态选择策略 | 交付控制面（不在步骤表上） | Closes #115 |
| #160 | 本机真的出现 worktree 与 branch，路径安全先于 Git | 步骤 7 | Closes #137 |
| #161 | 可绑定的人工执行 provider | 步骤 8 的失败形态 | Closes #139 |
| #158 | 客户端模型派生出首页 / 列表 / 详情的展示结构 | 步骤 4–5 的展示层 | Closes #128 |

判定标准取 `docs/review/mvp-review.md` §2：P0 = 合并即破坏 `main` 或硬约束；P1 = 严重正确性 / 安全 / 不变量缺陷，**或 PR 声称关闭的 issue 验收实际不成立**；P2 / P3 = 不阻塞交付的问题。P0 / P1 不合并。

## Context and Orientation

**锁定事实**（评审提交前重锁一次，与载荷 `commit_id` 逐一比对一致）：

| PR | head | base | 提交数 | diff |
|---|---|---|---|---|
| #158 | `8ed0d656ea05` | `main@940046ec15c3` | 10 | 7 文件 +1778 / −1 |
| #159 | `300e2a39c602` | `main@940046ec15c3` | 13 | 10 文件 +1222 / −125 |
| #160 | `1830136fd8d0` | `main@940046ec15c3` | 19 | 12 文件 +1460 / −18 |
| #161 | `c013dc9c31bb` | `feat/local-git-worktree@1830136fd8d0` | 9 | 6 文件 +1237 / −2 |

- 四个 PR 都是第二轮：第一轮的 30 条 inline 意见已全部回复并 resolve。本轮逐条复核"修复在当前 head 上是否成立"，不把已 resolve 当作已修好。
- `gh pr checks 158` 里的 `matrix.check fail` 是被同 head 后续运行取代而 `cancelled` 的 Rule checks（run `35851327057`），后继 run 的 Disclosure / PR size 均通过——不是缺陷。
- #161 的描述写 base `116c45f1`、证据 head `c69d4ef`：前者是当前 base 的祖先（落后 8 个提交），后者是 rebase 前的旧提交（GitHub API 仍可取到，但不在当前 9 个提交里）。以 `git merge-base --is-ancestor origin/feat/local-git-worktree origin/feat/human-execution-provider` 回读确认 #161 包含 #160 当前 head。

## Design / Spec

### 评审方法

1. **并集先于单 PR**。按 §4.7 声明的顺序（#159 → #160 → #161 → #158）在一次性 clone 里逐个变基、在并集树上跑门禁；再把在飞的 SQLite 栈（#121 → … → #175）叠上去看文本冲突面。理由：2026-09-18 那一轮唯一的 P0 只存在于分支并集里，单 PR 的 CI 不评估它。
2. **按 PR 分派子评审**，每个子评审只读、实验只在自己的一次性 clone 里做、变异前先打印变异行。模型按风险选择：#159（外部写入与规划轴正交）、#160（路径安全与破坏性 Git 操作）、#161（执行语义与重启恢复）用 Opus；#158（纯展示派生）与跨 PR 流程合规审计用 Sonnet。
3. **阻塞级结论必须由主评审独立复现**才采信；子评审的事实性表述与仓库状态不符的，按复核结果订正（见 Surprises）。
4. **全部矩阵建完后一次性提交**四份 review（`event=COMMENT`；评审者与作者是同一账户，GitHub 不允许 request changes），阻塞项标 `[blocking]`。

### 合并顺序假设

§4.7：#159 位置 1 先合并；#160 → #161 自下而上；#158 与二者无依赖。本轮结论把 #160 / #161 改为"本轮不合并"，于是实际合并顺序是 #159 → #158。

## Global Constraints

- 评审阶段对 GitHub 与四个 PR 的 worktree 只读；只有"无 P0 / P1"的 PR 在评审提交之后才进入修复。
- 就地修复的判据：改动机械 **且** 留着会在 `main` 上长期误导；否则开 follow-up issue。
- 改写已推送历史前先建恢复锚点（`backup/<worktree>-pre-review3`），推送只用精确 old-head lease 的 `--force-with-lease`。
- `Status`、`blocked-by` 与 issue 父子关系中需要人类裁决的部分不代为写入（`AGENTS.md` §7）。

## Plan of Work

### Batch 1 · 锁定事实与并集预演
锁定 head / base / checks / 线程；并集预演与门禁。

### Batch 2 · 分层评审（并行子评审）
每个 PR：代码正常 / 失败路径、产品闭环、架构边界、测试判别力（变异）、issue 验收逐条、第一轮修复复核；另一路审计提交卫生、PR 描述证据、标签、ExecPlan 完整性、发布面五类目与 §4.7 的事实一致性。

### Batch 3 · 复现、矩阵与一次性提交
主评审复现全部 P1 与关键 P2；开 follow-up issue；四份 review 一次性提交。

### Batch 4 · 可合并 PR 的修复、归档与合并
#159、#158：就地修复 → 归档 ExecPlan → 按交付物收敛提交 → 验证 → force-with-lease 推送 → 回读 → rebase merge → 回读 issue 与合并后的真实事件。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 并集层无 P0 | 并集树上 `pnpm verify` exit 0、`pnpm run boundaries` exit 0、`node scripts/workflow-check.mjs` 无发现、`git diff --check origin/main..<并集>` 无输出 |
| 2 | 每条 P1 有独立复现 | 下文「风险矩阵」P1 各行的"复现"列 |
| 3 | inline 意见一次性提交且锚定新增行 | 四份 review 各一次 POST；锚点逐条经 `git diff -U0 <base>...<head>` 核对在新增行内 |
| 4 | 合并的 PR 无未决 P0 / P1 | 本记录的矩阵与各 PR 的处置 |

## 并集预演

在检出 `origin/main@940046e` 的一次性 clone 里，按 #159 → #160 → #161（`rebase --onto` 去掉其 base）→ #158 逐个变基：

- 三次冲突都在 `docs/README.md` 的 Active ExecPlan 索引表（各 PR 在同一锚点后插自己一行），属 §4.7 预告的"两边都保留"形态；用 union 合并驱动模拟后，四行按位置有序、无冲突标记残留。
- 并集树（51 个提交）：`pnpm verify` → `ℹ tests 532 / pass 532 / fail 0` 与 `ℹ tests 7 / pass 7 / fail 0`；`pnpm run boundaries` → 7 / 7；`node scripts/workflow-check.mjs` → `no findings（已检查 8 个文件）`；`git diff --check` 无输出；`node scripts/rule-checks.mjs disclosure origin/main` exit 0。
- 再把 SQLite 栈的栈底 #121 变基到并集之上：只在 `docs/project-management/merge-queue.md` 冲突——#159 的 `### 4.7` 与 #121 的 `### 4.5` / `### 4.6` 落在同一插入点。§4.7 已写明"按编号各自保留"，由该栈在自己的位置上解决。

**结论：并集层无 P0。**

## 风险矩阵

### P0 —— 无

### P1 —— 阻塞合并

| PR | 条目 | 复现 | 处置 |
|---|---|---|---|
| #160 | `createWorktree` 对不可复用的状态仍报 `conflict`；`packages/core/src/git-provisioning.ts` 对 `Conflict` 不探测就 `confirmWrite`，于是 core 报假 `Ready` / `confirmed` | 主评审用真实 `provisionGit` + 本 provider 复现五例：主检出已检出该分支（无工作树却 ready）；同分支换新路径（新路径不存在）；已登记但检出 `other`；已登记但目录被换成普通目录（目录内 `git rev-parse --show-toplevel` 返回**主仓库**）；叶子为悬空符号链接 | 不合并；inline `provider.ts:189` |
| #160 | #137 验收 3 在复用发生的 core 层不成立：同名分支指向无关提交时 provider 报 `conflict`，core `branchProbe` 后复用，工作树 HEAD 落在无关提交 | 主评审复现（工作树 HEAD = 预置的 orphan 提交） | 不合并；inline `provider.ts:164` |
| #161 | `Closes #139` 与验收 2 不符：重启后经 Storage 读回的运行记录与 fake harness 的逐字段同形，人工运行的外部引用丢失（用例自己断言 `runExternalId === undefined`）；issue 的 Context（harness 失败降级为一等人工执行）未交付（#171）；上一轮回复声称"ExecPlan 与 PR 描述写明只对运行记录成立"，两处都检索不到，反而仍写"2 / 2 成立" | 主评审检索 ExecPlan 与 PR 描述、阅读重启用例 | 不合并；需人类裁决改 `Refs #139` 或改写验收；inline ExecPlan `:463` |

### P2

| PR | 条目 | 处置 |
|---|---|---|
| #160 | `paths.ts:74` 把非 ENOENT 的 `stat` 错误**抛出**（NUL 路径、EACCES 目录实测抛出），第一轮 F8 未修成；#174 的前提因此有误 | inline；随 P1 一并修 |
| #160 | 「登记在册但目录已消失」没有用例（把它改回 `Conflict` 后 35 / 35 全绿） | inline |
| #160 | 契约套件的 `provides` 由适配器自报，不与能力快照互校 | inline |
| #160 | `objects` 钩子对全能力替身从不被调用（改成 `throw` 仍 14 / 14），第一轮 F3 修复无效 | inline |
| #160 | #165 表征断言抓不住 #165 的首选修法，收口指令会误导 | inline |
| #160 | 证据数字互相矛盾、PR 描述 head 为占位符 `最终提交后回填`；11 个提交缺 `Refs` 尾注、4 个提交正文为空、"压缩说明 × 4 → 恢复注释"的来回提交 | inline + PR 级 |
| #161 | 收窄后的边界没有落到 ExecPlan 标题 / 范围；源码与用例注释指向"本 PR 描述点名的 follow-up"（应为 #171 / #172） | inline |
| #161 | 对同一原始引用取消两次得到两个不同的 canceled 事实（fake 返回 `conflict`）——主评审复现 | inline |
| #161 | #171 / #172 未挂到 epic #136 | PR 级；与 #139 的处置是同一个人类裁决，不代为写入 |
| #159 | Merged 终态不区分合并进 `main` 与合并进栈内父分支 | #176 |
| #159 | ExecPlan 把现场修复归功于补救入口；CI 日志显示 09:38:57Z–09:41:19Z 已由 `workflow_run` 修正（run `35844174428` / `35844271716` / `35844405970`）——主评审回读确认 | 就地修 |
| #159 | 被证伪的"下一次事件会重试"没有就地标注（D2、Decision Log、PR 描述） | 就地修 |
| #159 | §4.7 的 #161 行交付描述与冲突文件不实 | 就地修 |
| #158 | `WorkspaceRead` 六个字段只有 `store` 有生产者，且没有任何 issue 认领组装 | #178（挂 #124）+ ExecPlan 记录 |
| #158 | PR 描述证据停在旧 head（`b9e519d`、7 个提交、文档 782） | 最终 push 后更新 |

### P3

| PR | 条目 | 处置 |
|---|---|---|
| #160 | defaultBranch 回退到当前分支；stderr 取首行丢原因；NotFound 正则遮蔽 `validation failed`；与短 sha 同名的分支；含换行的路径与无 `-z` 的 porcelain；默认允许根是仓库父目录 | inline |
| #161 | `isInstant` 过宽（两个存活变异）；`cancelRun` 无往返守卫；故障开关运行时可改；降级用例仍被说成步骤 8；"不靠进程内存"只到实例级 | inline |
| #159 | §4.7 易失状态；回读期望与数字过期；import 闭包守卫可被绕过；`ci.md` 未保留原文 | 就地修 |
| #159 | 部分写入；外仓 issue 串号 | #177 |
| #159 | 实测日期写成 2026-09-24（40 处，与批次计划日同源） | ExecPlan 加一行"日期说明"，不逐处改写 |
| #158 | 能力规则与 key 字面量在 ui-model 复刻（依赖矩阵 `ui-model -> client, domain` 的直接后果，有差分测试钉住，不构成第二权威源） | 并入 #178 验收 3 |
| #158 / #160 / #161 | 分支前缀 `feat/` 不在 `AGENTS.md` §6 的允许集合内 | 只记录：合并后分支删除、不进入 `main`；改名会连带改动 #161 的 base 与本地 worktree 跟踪 |

## MMP 判定

| PR | 产品闭环是否成立 | 对 R1（`docs/architecture/release-gates.md` §2）的影响 |
|---|---|---|
| #159 | 成立（代码层）；真实 `pull_request_target` 路径只能合并后回读 | 不在 R1 条目上；它消除的是交付控制面上"观察者红而无事件能清"的故障 |
| #158 | #128 四条验收全部成立；但它的输入契约今天只有 `store` 有生产者——**epic #124 步骤 1–5 的演示依赖 #178** | R1 第 11 条（人工 UAT）在 #178 之前无法走通步骤 4–5 |
| #160 | **不成立**：步骤 7 的"本机出现 worktree 与 branch"可以被报告为 Ready 而实际不存在或检出错误 | R1 第 10 条（Start Work 失败恢复）在修复前无法判为满足；#165（不变量 6）同样挡在这里 |
| #161 | 部分：可绑定的人工 provider 成立；"会话起不来降级为人工"（#171）与"重启后读回人工运行"（#172）未交付 | R1 第 10 条的"执行启动失败降级为人工、重启后可恢复"依赖 #171 / #172 |

R1 第 6 条（没有未关闭的 P0 / P1 正确性缺陷）：本轮新增的 3 条 P1 都在未合并的 PR 上，不进入 `main`；但 #165、#171、#172 是 `main` 上已存在的缺口，首发前必须关闭。

## 判别性证据

- **#159 import 闭包守卫**（修复后，在检出 `fix/engineering-merged-terminal` 的 `.worktrees/w10-d1` 里）：往 `scripts/sync-engineering-state.mjs` 的 shebang 之后分别插入 `import { execFile } from "node:child_process"`、`import 'node:https'`、`await import('node:child_process')`，每次先 `sed -n '1,2p'` 确认变异落地，再对新旧两版守卫跑 `node --test --test-name-pattern='import 闭包'`：

  ```text
  == mutation: 2:import { execFile } from "node:child_process"
    new guard: ℹ pass 0 ℹ fail 1
    old guard: ℹ pass 1 ℹ fail 0
  == mutation: 2:import 'node:https'
    new guard: ℹ pass 0 ℹ fail 1
    old guard: ℹ pass 1 ℹ fail 0
  == mutation: 2:await import('node:child_process')
    new guard: ℹ pass 0 ℹ fail 1
    old guard: ℹ pass 1 ℹ fail 0
  ```

  还原后 `node --test tests/contract/engineering-drift.test.js tests/contract/engineering-state.test.js` → `ℹ tests 96 / pass 96 / fail 0`。
- **子评审的变异**（各自一次性 clone；这些是非阻塞项的判别力证据，采信子评审的实测输出，主评审未逐条重跑）：#159 去掉 Merged 优先 → 6 红、去掉 `includeClosedPrs` → 1 红、去掉截断检查 → 2 红；#158 陈旧时返回 `[]` → 19 / 2、PR-backed 行给 `start_work` → 20 / 1；#160 删掉 `..` 分量拒绝 → 路径安全零调用用例红；#161 忽略 `startUnavailable` 故障 → 端到端 24 / 2。

## Progress

- [x] Batch 1 · 锁定事实与并集预演（并集层无 P0）
- [x] Batch 2 · 五路子评审（#158、#159、#160、#161、流程合规）
- [x] Batch 3 · 主评审复现 #160 两条 P1、#161 的 P1 与双重取消、#159 的 CI 日志；开 #176、#177、#178（#178 挂到 #124）；四份 review 一次性提交：#160 13 条、#161 8 条、#159 11 条、#158 2 条 inline，共 34 条
- [x] Batch 4 · #159 就地修复、归档、按交付物收敛提交（本记录随它合并）
- [ ] Batch 4 · #158 变基到含 #159 的 `main`、修复、归档、合并——在本记录合并之后进行，结果以 `gh pr view 158 -R SingularityKChen/harness-projects --json state,mergedAt` 回读为准
- [ ] 合并后回读 #159 的真实 `pull_request_target` 运行——命令与期望见 `docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md`「合并后的回读对象是具体的」之下的 `Superseded by`；结果发在 PR #159 上

## Surprises & Discoveries

- **第一轮"已修复"的四处在当前 head 上并未修成**：#160 的 F3（`objects` 钩子从不被调用）、F8（错误被抛出而不是分类）、F9（数字仍矛盾），#161 回复中声称已写入文档的那句话。resolve 的 thread 不是修复的证据，复核必须跑在当前 head 上。
- **子评审的一条事实表述与仓库不符**：#161 的证据 head `c69d4ef` 被报告为"公开仓库中不存在"，实为 rebase 前的旧提交——新 clone 里 `git cat-file` 找不到（不可达对象不随 clone 传输），GitHub API 仍能取到。已按复核结果写入 review。
- **另一条候选被驳回**：PR 描述与 ExecPlan 里出现的模型代号在 `main` 上已有 5 处先例（`docs/development/workflow.md`、`docs/review/responding.md` 等），不按发布面违规处理。
- 本机 `rm` 与 `cp` 一样带 `-i`：删除临时测试文件时整条命令停在确认提示上直到超时。删除用 `/bin/rm -f`。

## Decision Log

- **Decision**：#159、#158 本轮合并；#160、#161 本轮不合并。
  **Rationale**：前两者无 P0 / P1，P2 / P3 或就地修复、或已有 follow-up；后两者各有独立复现的 P1，且 #161 依赖 #160。
  **Date/Author**：2026-09-23 / agent（合并由用户在本轮任务中明确授权：无 P0 / P1 时修复、归档、整合提交后 rebase merge）
- **Decision**：不替人裁决 #139 的处置（改 `Refs` 还是改写验收），也不把 #171 / #172 挂到 #136。
  **Rationale**：两者都改变规划事实（哪个 issue 算完成、epic 何时可关），`AGENTS.md` §7 要求人类批准。
  **Date/Author**：2026-09-23 / agent
- **Decision**：#159 的 40 处"2026-09-24"不逐处改写，只加一行日期说明。
  **Rationale**：它与批次计划日、文件名同源；逐处改写的出错风险高于收益，说明一行即可消除误导。
  **Date/Author**：2026-09-23 / agent
- **Decision**：`feat/` 分支前缀只记录、不改名。
  **Rationale**：rebase merge 后分支被删除，不进入 `main`；改名会连带改动 #161 的 base 与本地 worktree 的上游跟踪，收益为零。
  **Date/Author**：2026-09-23 / agent
- **Decision**：#160 / #161 的单 PR 评审记录写在各自 worktree（`.worktrees/w11-d2a`、`.worktrees/w12-d2b`）的 `docs/review/` 下，不推到它们的分支。
  **Rationale**：推一个提交到 #160 会移动 #161 的 base、给正在返工的作者制造额外变基；完整的矩阵与证据已由本记录随 #159 进入 `main`，单 PR 记录由作者修复 P1 时一并提交。
  **Date/Author**：2026-09-23 / agent

## Idempotence and Recovery

- 评审阶段只读；inline 意见一经提交不可撤回（只能编辑或删除评论），因此在提交前对每个锚点做了 diff 内核对。
- 历史改写的恢复锚点：`backup/w10-d1-pre-review3`（#159，`300e2a3`）、`backup/w14-d3b-pre-review3`（#158，`8ed0d65`）。恢复：`git push --force-with-lease=refs/heads/<分支>:<当前远端 head> origin backup/<…>:refs/heads/<分支>`。
- 并集预演在会话临时目录的一次性 clone 里做，不触碰任何 worktree。

## Interfaces and Dependencies

- follow-up：#176（Merged 的 base 语义）、#177（写入口部分写入与外仓串号）、#178（组装 `WorkspaceRead`，挂 #124）；既有：#165、#171、#172、#173、#174。
- 依赖的仓库规则：`AGENTS.md` §1.1、§6、§7；`PLANS.md` §4；`docs/review/mvp-review.md`；`docs/project-management/merge-queue.md` §2.2、§4.7。

## Outcomes & Retrospective

- 四份 review、34 条 inline 意见；3 条 P1（#160 × 2、#161 × 1），0 条 P0。
- 本轮合并 #159、#158；#160、#161 等待作者修复 P1 后重新锁定 head、重跑并集与本记录中的反例。
- 教训：**"thread 已 resolve" 与 "缺陷已修复" 是两件事**。第一轮的 30 条意见全部 resolve，本轮复核发现其中 4 处在当前 head 上不成立，且都有可执行的反证。复评时逐条复跑，不采信 resolve 状态。

## Bottom Change Note

- (2026-09-23) 创建本记录：锁定事实、并集预演、五路子评审、P1 复现、34 条 inline 意见、#159 的就地修复与合并决定。
