# Start Work 批次（#160 → #161、#185）MMP 交付评审

> 状态：Completed（评审已提交；#185 按本记录的处置合并，#160 / #161 本轮不合并）
> 评审日期：2026-09-24（Asia/Shanghai）
> 范围：PR #160（第三轮）、#161（第三轮）、#185（第一轮）。#160 → #161 是 GitHub 原生 stack；#185 的 base 是 `main`，与二者代码文件集不相交，但修的是 #160 集成用例里被写成期望值的 #165
> 评审方式：锁定 head / base 与既有线程 → 两种顺序的并集预演 → 按 PR 分派只读子评审 → 阻塞级结论由主评审在 base / head / 并集三处独立复现 → 建完 P0–P3 矩阵后一次性提交全部 inline 意见 → 只对"无 P0 / P1 代码问题"的 PR 就地修复并合并

## Purpose / Big Picture

这一批对应 `docs/product/vertical-path.md` §2 步骤 6–8 与 `docs/architecture/release-gates.md` §2 第 10 条（Start Work 失败恢复）：真实本地 Git 上出现工作树与分支（#160）、可绑定的人工执行一端（#161）、以及中断 / 失败之后补偿序列能续能重试、同一份工作树只有一个身份（#185）。要回答的是"合并之后 MMP 的这段闭环是否真的多成立了一段"，而不是"测试是否全绿"。

## Context and Orientation

| PR | 轮次 | head | base | 关联 |
|---|---|---|---|---|
| #160 | 第三轮 | `410eafcbab70` | `main@484f0d355e60` | Closes #137 |
| #161 | 第三轮 | `46cec27e6bd3` | `feat/local-git-worktree@410eafcbab70`（已核实包含） | Refs #139 |
| #185 | 第一轮 | `9bd3edd0e0c9` | `main@484f0d355e60` | Closes #184 #165；评审后改 Refs #183 |

- 评审提交前重锁一次 head，与三份载荷的 `commit_id` 逐一一致。
- `main` 的分支保护：必需检查只有 `PR Fast Gate`，`strict = true`（`gh api repos/SingularityKChen/harness-projects/branches/main/protection --jq .required_status_checks`）。

## Design / Spec

- **并集先于单 PR**：两种顺序（#160 → #161 → #185 与 #185 → #160 → #161）各变基一次；`docs/README.md`、`tests/integration/README.md` 两个索引文件用 union 驱动模拟"两边都保留"，其余文件的冲突如实报告。
- **子评审**：#160（路径安全与破坏性 Git 操作）、#185（core 状态机、身份与恢复语义）用 Opus；#161（第三轮收紧）与流程合规审计用 Sonnet。子评审只写 `comments.json`，完整报告在回复里，由主评审落盘。
- **阻塞级复现**：同一段脚本在 base、head 与并集上各跑一次，写明三者对照，区分"本 PR 引入"与"`main` 既有"。

## 并集预演

- 两种顺序都能文本变基（只有两个索引文件的"两边都保留"型冲突）。
- 并集树 `pnpm verify` 554 条里唯一的红：#160 `tests/integration/development-local-git.test.js:197-198` 把 #165 的缺陷写成期望值（`hasWorktree.length === 2`），#185 修好后 actual 1。两种顺序结果相同。
- 按该用例注释的收口指令改成 `=== 1` 后：`pnpm verify` 554 / 554 + 7 / 7、`pnpm run boundaries` 7 / 7、`node scripts/workflow-check.mjs` 无发现。
- strict 分支保护保证后合并的一方必须在含前者的树上重跑必需检查，所以这不是会打坏 `main` 的 P0，而是**硬性的合并顺序依赖**：后合并的一方负责改这两行。本轮 #185 先合并，由 #160 改。

## 风险矩阵

### P0 —— 无

### P1

| PR | 条目 | 复现（base / head / 并集） | 处置 |
|---|---|---|---|
| #160 | `provider.ts:259` 的 prunable 判定用整字段相等，而 git 输出总带原因（`prunable gitdir file points to non-existent location`），恒为假；第二轮反例 C（登记在册、目录被换成普通目录）仍是 `conflict` → core `ready / confirmed`，目录内 `git rev-parse --show-toplevel` 指向主仓库。作者称已修 | base：provider 是占位包，脚本 import 失败（本 PR 引入）；head、并集：`ok / ready / confirmed` | 阻塞 |
| #160 | `provider.ts:71` 默认允许根 `<repo>/.worktrees` 在新仓库里不存在，第一次 `createWorktree` 即 `invalid_input`（`realpath` ENOENT），`provisionGit` 随之 `failed`；`mkdir .worktrees` 后成功。第二轮 [13] 的修法引入 | head 复现（子评审定 P2，主评审升为 P1：本 PR 的闭环在默认配置、新仓库上不成立） | 阻塞 |
| #185 | `Closes #183`：验收 2 要求真实临时仓库用例，本 PR 只有替身；验收 3 在 >100 分支时部分成立 | 用真实 provider 复跑 S1：`main`+#160+#161 上 `failed / invalid_input`，叠上 #185 后 `ready` 并报头提交——行为成立，证据不在本 PR | **非代码缺陷**：改 `Refs #183`（沿用 #161 `Closes #139` 的人类裁决先例），#183 保持开启并写明剩余项 |

### P2

| PR | 条目 | 处置 |
|---|---|---|
| #160 | `conflict` 前不确认目录真是这份工作树：目录换成独立仓库（N3a）、先 lock 再替换（N3b）、`worktreePath` 指向主检出（N10b）都假 Ready——与 P1 同类，前缀匹配修不掉 | 随 P1 修 |
| #160 | 大小写变体 / 符号引用绕过"分支已在别处检出"（macOS 上两份工作树共享一个分支） | 待修 |
| #160 | #165 表征：标题写"只保留一条"、断言钉"两条"，与 #185 的合并顺序耦合 | #160 变基时改为 `=== 1` |
| #160 | `tests/integration/README.md`、ExecPlan 的旧语义未就地标注；证据数字与"实测证据"列不可复现；已提交的第二轮评审记录以"Blocked"进入 `main` | 待修 |
| #161 | ExecPlan `:14` / `:81` 仍是"本 PR 描述点名的 follow-up issue"；`:3` 与 PR 描述的 base 过期；缺 `Bottom Change Note` 标题 | 待修（随 #160 之后合并） |
| #185 | 没有 provider 的失败路径抹掉已记录分支（S8）；`branchProbe` 只读第一页、controller 丢头提交（S10） | #183 剩余项 |
| #185 | 工作树步失败仍写 confirmed `has_worktree`（S3，`main` 同样存在） | #192 |
| #185 | 第三步（启动执行）不可续（`main` 同样存在） | #193 |
| #185 | 同 key 换请求返回假 `saved`（`main` 同样存在，源码注释自承） | #194 |
| #185 | `docs/README.md` 的 Active 表被整段改写：8 个 completed 计划从索引消失、两行重复 | 就地修 |

### P3

- #160：`defaultBranch` 回退未改而回复称已改；D/F 引用冲突落成 `ambiguous_result`；悬空叶子由 git 兜底；Unicode 空白误拒；套件双向断言只覆盖变更请求；Bottom Change Note 缺条目；分支前缀 `feat/`（已记录）。
- #161：提交 scope `integration` 不在 area 词表、末位提交缺 scope；"#171 / #172 未挂子 issue"已过期。
- #185：`chain-facts.ts` 骨架注释与实现相反、`tests/integration/README.md` 与 `tests/README.md` 的表述、"每个批次可独立 revert"——就地修；退化 id 留 Failed 上下文、`Closed` 可接管（替 #138 决定）、工作树路径未"决定"、旧 key 重放的混合结果——记入该计划遗留。

## MMP 判定

| PR | 闭环是否成立 | 对 R1 第 10 条的影响 |
|---|---|---|
| #160 | **不成立**：默认配置下新仓库首个工作树创建失败；目录被替换时仍报 Ready | 步骤 7 在修复前不能判为满足 |
| #161 | 成立（可绑定的人工执行 provider），但受 #160 阻塞 | "执行启动失败降级为人工"仍依赖 #171 / #172 |
| #185 | 成立：真实 provider 上 11 个场景无假 Ready；"中断后续、失败后重试、同一工作树一个身份"都在真实 Git 上复现成立 | 推进"重复开始不产生第二份、重启后可恢复"；剩余缺口是 #183 剩余项、#192、#193 |

## Decision Log

- **Decision**：本轮只合并 #185；#160、#161 不合并。
  **Rationale**：#160 有两条独立复现的代码 P1；#161 叠在 #160 上。#185 唯一的 P1 是关闭声明与证据不符，改 `Refs #183` 即与证据一致；其余为 P2 / P3。
  **Date/Author**：2026-09-24 / agent（合并由用户在本轮任务中授权：无 P0 / P1 代码问题时修复、归档、整合提交后 rebase merge）
- **Decision**：#185 的 `Closes #183` 改为 `Refs #183`，不改写 #183 的验收。
  **Rationale**：与上一轮 #161 的同类问题由人类裁决为"改 `Refs`、issue 保持开启"同形；改写验收属于规划决定，不代为执行。
  **Date/Author**：2026-09-24 / agent
- **Decision**：#160 的 `provider.ts:71` 由子评审的 P2 升为 P1。
  **Rationale**：主评审复现后确认它让本 PR 自己声明的闭环在默认配置、新仓库这一最常见的起点上不成立。
  **Date/Author**：2026-09-24 / agent
- **Decision**：#160 / #161 的本轮评审记录写在各自 worktree（`.worktrees/w11-d2a`、`.worktrees/w12-d2b`）的 `docs/review/` 下，不推到它们的分支。
  **Rationale**：推提交到 #160 会移动 #161 的 base；本记录已随 #185 进入 `main`，作者修复时一并提交单 PR 记录并更新已提交的第二轮记录的状态。
  **Date/Author**：2026-09-24 / agent

## Idempotence and Recovery

- 历史改写的恢复锚点：`backup/w16-recovery-pre-review1`（#185，`9bd3edd`）。
- 并集预演在会话临时目录的一次性 clone 里做，不触碰任何 worktree。

## Outcomes & Retrospective

- 三份 review、33 条 inline 意见（#160 15、#161 4、#185 14）；P1 共 3 条（#160 × 2、#185 × 1）。
- 合并结果以回读为准：`gh pr view 185 -R SingularityKChen/harness-projects --json state,mergedAt,mergeCommit`。
- #160 重新进入排队的条件：两条 P1 修复（C / N2 各补经 `provisionGit` 的用例，N3a / N3b / N10b 一并正面确认）、`:197-198` 改为 `=== 1`、对含 #185 的新 `main` 重做预演；#161 随后按 `git rebase --onto origin/main <#160 合并前的 head>` 收口。
- 教训：**并集预演用 union 驱动模拟索引文件的"两边都保留"时，看不见单个 PR 对索引表的整段改写**——#185 的 `docs/README.md` 回退是流程审计逐行比对才发现的。索引文件要单独对 `main` 做 diff，不能只看并集能否合上。

## Bottom Change Note

- (2026-09-24) 创建本记录：锁定事实、两种顺序的并集预演、四路子评审、三条 P1 的三处对照复现、33 条 inline 意见、#185 的处置与合并决定。
