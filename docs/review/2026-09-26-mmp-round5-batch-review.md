# SQLite v1 栈（#121–#175）与 Start Work 栈（#160 → #161）MMP 交付评审

> 状态：Completed（评审已提交；#121 / #122 / #157 / #167 修复后合并，#170 / #175 / #160 / #161 本轮不合并）
> 评审日期：2026-09-25 至 2026-09-26（Asia/Shanghai）
> 范围：SQLite v1 栈第五轮（#121 → #122 → #157 → #167 → #170 → #175，GitHub 原生 stack）；Start Work 栈第四轮（#160 → #161）。任务里的「#200」是 issue（#160 第三轮评审开出的契约套件缺口），按 issue 验收处理，不是 PR
> 评审方式：锁定 head / base / checks / threads → 两栈两种顺序的并集预演 → 按 PR 分派只读子评审 + 一个流程审计 → 阻塞级结论由主评审在 head 与并集上独立复现 → 建完 P0–P3 矩阵后一次性提交八份 review → 只对「无 P0 / P1 代码问题」的 PR 就地修复、整理提交、归档计划并 rebase merge

## Purpose / Big Picture

回答「合并之后 MMP 的哪一段闭环真的多成立了一段」，而不是「测试是否全绿」。SQLite 栈的交付是一个跑满 Storage 端口的 SQLite 实现（#120），但没有宿主 import 它、core 在 SQLite 上 Start Work 仍抛裸外键——整栈合并后用户观察不到变化，这一点必须写清；Start Work 栈的交付是真实本地 Git 上出现工作树与分支（#137）以及可绑定的人工执行（#139，只到 `Refs`）。

## Context and Orientation

| PR | 轮次 | 评审时 head | 评审时 base | 关联 | 结论 |
|---|---|---|---|---|---|
| #121 | 5 | `d01ed0e` | `main@b639c9e` | Refs #119 | 无 P0 / P1 → 修复后合并 |
| #122 | 5 | `1a7dc70` | #121 head | Refs #27 | 无 P0 / P1 → 修复后合并 |
| #157 | 5 | `abcd9e2` | #122 head | Refs #28 | 无 P0 / P1 → 修复后合并 |
| #167 | 5 | `89d1a9e` | #157 head | Refs #163（修复后关闭） | 无 P0 / P1 → 修复后合并 |
| #170 | 5 | `d84bc16` | #167 head | Refs #164 | **1 × P1**，不合并 |
| #175 | 5 | `253c34d` | #170 head | Closes #120、Refs #5 | **2 × P1**，不合并 |
| #160 | 4 | `01605c2` | `main@b639c9e` | Closes #137 | **2 × P1** + 体量 1121 / 1000，不合并 |
| #161 | 4 | `5d43693` | #160 head | Refs #139 | 无 P0 / P1 / P2，受 #160 阻塞 |

- 分支保护：唯一必需检查 `PR Fast Gate`，`strict = true`；仓库只允许 rebase merge，`delete_branch_on_merge = true`。
- 八份 review 的 id：#121 `5319932064` · #122 `5319932757` · #157 `5319934035` · #167 `5319934984` · #170 `5319936286` · #175 `5319966172` · #160 `5319986028` · #161 `5320004702`，共 101 条 inline（8 / 18 / 13 / 14 / 17 / 11 / 18 / 2）。提交前重锁八个 head，与载荷的 `commit_id` 逐一一致。

## Design / Spec

- **并集先于单 PR**：一次性 clone 里两种顺序（SQLite 栈 → Start Work 栈、反序）各变基一次；`docs/README.md` 与 `tests/integration/README.md` 用 union 驱动模拟「两边都保留」，索引文件另外逐行对 `main` 比对（上一轮的教训）。
- **子评审**：代码与不变量密集的六个（#122、#157、#167、#170、#175、#160）用 Opus；#121（文档与守卫）、#161（小 provider）与跨 PR 的流程审计用 Sonnet。子评审只读、只写 `comments.json`，不碰 GitHub 与 worktree。
- **阻塞级复现**：每条 P1 由主评审用自写脚本在 head 与并集上各跑一次，并写明 base 上的对照。

## 并集预演

- 两种顺序都能文本变基，唯一冲突是 `docs/README.md` 索引。
- 两栈各自的栈顶单独跑 `pnpm verify` 全绿；**并集树上 `tests/integration/development-local-git.test.js` 5 条红**（两种顺序相同）：`provider binding workspace does not exist`。根因是 #160 的夹具 `coreContextFor` 没有先 `putWorkspace` 就 `registerBindings`，而 #122 起替身与 SQLite 的外键一致地要求工作区先存在；core 自己的 `createContext` 总是先建工作区。strict 分支保护保证后合并的一方会在含前者的树上重跑必需检查，所以这是**硬性的合并顺序依赖**，不是 P0：修法落在 #160（改用 `createContext`，子评审实测 head 与并集上都是 23 / 23）。

## 风险矩阵

### P0 —— 无

### P1（主评审独立复现）

| PR | 条目 | 复现 |
|---|---|---|
| #160 | 默认允许根本身是符号链接时不核对：仓库里被跟踪的 `.worktrees -> ../planted` 让 Start Work 在仓库外建工作树并报 `ready / confirmed / saved` | head `01605c2` 与并集各跑一次：`wt = <tmp>/planted/WI-2`；`main` 上 provider 是占位包（本 PR 引入）。违反 `AGENTS.md` §7，#137 验收 1 在默认配置下字面不成立 |
| #160 | 默认分支「不知道」时回落到 `main`：`git init -b master` 且无远端的仓库上 Start Work `failed / not_found「起点不存在」` | 同一脚本在 `main` 仓库上 `ready`；上一版 `410eafc` 在 `master` 上分支步成功。子评审定 P2，主评审按第三轮 N2 的先例升级 |
| #170 | 改写历史丢失已验收的判别性用例：第四轮 head `ae39655` 上的 SQLite 身份同步组注册、装配守卫、结算令牌用例与两条同步用例在当前 head 上都不存在，提交正文与 thread 回复却声称新增了四条共享用例 | `git show ae39655:tests/contract/storage-contract.test.js` 对照 `d84bc16`；`fd33899` 的 diff 只有 16 行；子评审的变异（`putMembership` 改 `mutate`、去掉 `object_kind`、不注册 SQLite 同步组）全部存活 |
| #175 | SQLite 不跑执行组与身份同步组：PR 标题与 #120 验收 1 不成立 | `253c34d` 的装配只有地基组、身份地基组、同步组三处 SQLite 注册 |
| #175 | `replacePlanningProjections` 从 `atomic` 改回 `mutate`，钉住它的重启用例被删 | base 的 `storage-restart.test.js` 放到 head 上：`actual: []`，外键失败把既有投影整批删掉 |

#170 与 #175 的 P1 同一根因：第四轮之后 L5 / L6 的改写丢了内容。第四轮 head（`ae39655` / `693aba4`）与作者本地的 `backup/l6-wip`（`a3c46b8`）里都还有，修法是取回而不是重写。

### 降级（理由写在对应 inline 末尾）

- #121 子评审的 3 条 P1：两条守卫正则比声明目的窄（P2）、裁决句子归属被插入条目打断（P3）——文档纪律缺口，不是产品、安全或不变量控制。
- #157 子评审的 2 条 P1 候选：ISO-8601 变精度载体的码点序（今天不可达，#203）、R8「调用方先读当前行」没有调用方（#204）——降为 P2。
- 流程审计把 #122 / #157 / #170 的描述损坏（每个字符之间插入 `Refs #N`）定为 P1：非代码、可机械修复，按 PR 级 P2「合并前必修」处理。

### P2 / P3 计数（inline）

| PR | P2 | P3 |
|---|---|---|
| #121 | 5 | 3 |
| #122 | 6 | 12 |
| #157 | 7 | 6 |
| #167 | 5 | 9 |
| #170 | 7 | 9 |
| #175 | 5 | 4 |
| #160 | 6 | 10 |
| #161 | 0 | 2 |

另有跨 PR 的 PR 级项：六个 SQLite 栈描述不可读或是未填充模板、#157 / #167 / #170 的收尾提交没有正文、标签与 diff 不符、#160 体量 1121 / 1000 需要人类裁决。

## MMP 判定

| PR | 闭环是否成立 | 说明 |
|---|---|---|
| #121 | 成立 | 控制计划只写当前时点事实；#119 验收 1 如实记为不成立，待人类伙伴在补观测与收窄验收之间决定 |
| #122 | 成立 | 移出再移回已修（变异 F27 使其变红）；#27 验收 3 只到「至多一个 primary」（#190） |
| #157 | 成立 | 003 落库；不变量 5 的 `source` 词表第五轮起有判别用例 |
| #167 | 成立 | 地基面与事务机制；#163 验收 6 第五轮补齐后字面满足 |
| #170 | **不成立** | 行为在 head 上正确，但声明的判别性证据被改写历史丢掉 |
| #175 | **不成立** | SQLite 没有跑两组契约；`atomic` 回退造成事务外调用时的静默删行 |
| #160 | **不成立** | 默认配置下工作树可被仓库内容引到仓库外；`master` 新仓库上 Start Work 失败 |
| #161 | 成立（受阻塞） | 可绑定的人工执行 provider；自动降级仍依赖 #171 / #172 |

## 修复与合并（L1–L4）

每层的做法相同：按上一层合并前的 head 做 `git rebase --onto origin/main`，逐文件核对本层自己的改动与重写前逐字相同（只允许下层修复触及的文件不同），再就地修复、整理提交、跑全部门禁、带精确 lease 推送、刷新描述、逐条回复并 resolve、回读 checks 后合并。

| 层 | 就地修复 | 转 issue | 整理后的提交 | 合并 |
|---|---|---|---|---|
| #121 | 两条守卫按 GitHub 关闭关键字表与三种路径写法判定（五种绕过各红一条，L2–L6 零新增命中）；裁决句子接回原行并补 #119 验收 1 的待决项；文件清单与回滚说明补第二个守卫；`merge-queue.md` 补栈成员合并入口；层计划归档 | — | 2 | `main@e390258` |
| #122 | `Refs #27` 的理由改成真实代价并补 Decision Log；收敛计划的未来层事实、表头、D3 / D8、处置表订正；端口注释补「挂载的工作区必须已存在」（同行替换，代码仍 1000 / 1000）；层计划归档 | #201（约束测试债）、#202（不变量 1 的派生层面） | 2 | `main@5ac591f` |
| #157 | 恢复被本层撤回的两条 L2 守卫；补 `source` 词表、定序主体三维与比较器两格（各自的变异都红）；R8 改成如实的「当前没有强制点」；上层事实改义务措辞；ADR-0002 恢复原文；标签按 diff 订正；层计划归档 | #201、#203（ISO 载体）、#204（R8 写前落 pending） | 3 | `main@8390a4b` |
| #167 | 结算检查改到执行时（未 await 的 `tx.*` 不再在 ROLLBACK 后落库）；令牌生命周期用例放回本层（三个变异各红）；#163 验收 6 补端口写入并改为关闭 #163；消息原文、来处回读、名字引用、恢复路径与遗留清单订正 | #201（切分守卫基线、SQLite 注册守卫、投影分叉） | 3 | 回读 `gh pr view 167 -R SingularityKChen/harness-projects --json mergeCommit` |

- **合并机制实测**：`PUT /pulls/<n>/merge`（`merge_method=rebase`）对栈成员返回 403「Merging stacked PRs via this endpoint is not supported」；`PUT /pulls/<n>/merge-async` 返回 202 并在数秒内完成，下一层自动 retarget 到 `main`。与 #121 写进 `merge-queue.md` §4.5 的说法一致。
- 每层整理后都核对了「只回滚某一个提交」仍然全绿，并用 `git diff <备份> HEAD` 的逐文件归属确认没有丢内容（本轮 L5 / L6 的 P1 正是这一步缺失的后果）。

## Decision Log

- **Decision**：本轮合并 #121、#122、#157、#167；#170、#175、#160、#161 不合并。
  **Rationale**：前四个无 P0 / P1 代码问题；#170 / #175 / #160 各有独立复现的 P1，#161 叠在 #160 上。
  **Date/Author**：2026-09-26 / agent（合并由用户在本轮任务中授权：无 P0 / P1 代码问题时修复、归档、整合提交后 rebase merge）
- **Decision**：需要新增代码行、而该层已到体量上限的修复一律转 issue，不在该层就地补。
  **Rationale**：#122 代码恰为 1000 / 1000；`AGENTS.md` §6 / §8 的上限没有豁免机制，豁免需要人类批准。
  **Date/Author**：2026-09-26 / agent
- **Decision**：契约组（`tests/contract/suites/storage.js`）的新增格一律转 #201，不在 L3 加。
  **Rationale**：L4 重排该文件并用断言多重集基线守护，L3 加格会级联到每一层，包括作者负责的 L5 / L6。
  **Date/Author**：2026-09-26 / agent
- **Decision**：只归档单层计划（L1 / L2 / L3），跨层计划（控制计划、收敛计划、响应计划、L4–L6 的 `storage-sqlite-port`）保持 Active。
  **Rationale**：跨层计划的范围在 L5 / L6 合并前没有完成。
  **Date/Author**：2026-09-26 / agent
- **Decision**：#160 的 `Closes #137` 与 `LOCAL_GIT_FAILURE` 字面、#28 的关闭归属、#119 验收 1、#27 验收 2 的委托都不代为改写 issue，只在 issue 评论里登记证据与待决项。
  **Rationale**：改写验收属于规划决定。
  **Date/Author**：2026-09-26 / agent

## Idempotence and Recovery

- 恢复锚点（本地）：`backup/l1-pre-round5-fix`（`d01ed0e`）、`backup/l2-pre-round5-fix`（`1a7dc70`）、`backup/l3-pre-round5-fix`（`abcd9e2`）、`backup/l4-pre-round5-fix`（`89d1a9e`）。
- #170 / #175 的收口：`git rebase --onto origin/main 89d1a9ebcd40e1f47671a3b1c18197ac882b79a5 feature/storage-sqlite-sync-surface`，再对 #175 以 #170 重放前的 head 做同样的 `--onto`；预期冲突在 `docs/README.md`（两边都保留）、收敛计划的「本层实测」行（按层号改）、`storage-sqlite-port.md` 的上游路径行（已改为 completed 路径）。L4 已把 `suites/storage-sync.js:96` 的消息恢复成原文，#170 的基线里同一项要随之更新。
- #160 / #161 未被改动；#160 修复后按 `git rebase --onto origin/main <#160 合并前的 head>` 收口 #161。

## Outcomes & Retrospective

- 八份 review、101 条 inline；P1 共 5 条（#160 × 2、#170 × 1、#175 × 2），全部在 head 与并集上独立复现。四个 PR 合并，四个新 issue（#201–#204）承载就地修复不了的部分。
- **教训 1（改写历史）**：L5 / L6 的 P1 都来自「reset 后重新提交」丢内容，而 thread 回复仍按丢失前的内容写。级联或整理提交后，必须逐文件核对本层自己的改动与重写前逐字相同，不能只看测试是否全绿——测试全绿恰恰是丢了测试的样子。
- **教训 2（守卫要能失败）**：放宽后的关闭关键字守卫在 L4 抓到了评审者自己写进计划的关闭断言；守卫的价值在于它会对写它的人失败。
- **教训 3（PR 描述是发布面）**：三个 PR 的描述被模板替换写坏、两个留着占位符，`Issue policy` 反而因为注入的 `Refs #N` 通过。推送前应对描述做占位符与关联回读，而不是只回读 `closingIssuesReferences`。

## Bottom Change Note

- 2026-09-26：创建本记录：锁定事实、两栈两种顺序的并集预演、九路子评审、五条 P1 的独立复现、101 条 inline、L1–L4 的修复与合并、四个新 issue。
