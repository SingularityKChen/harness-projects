# PR #688 MMP 独立验收：单资产基线后历史 ADR 指针订正（#666）

> 评审身份：独立对抗验收 reviewer（非实现者，未参与该分支实现；未采信实现者摘要与日志）
> 评审对象：PR #688（Closes #666）；执行上下文：检出 `docs/adr-pointer-reconcile-20261124`，工作树 `.worktrees/iteration12-adr-pointer-reconcile`
> 记录日期：2026-11-24；下文所有命令均在上述工作树根运行（`gh` 命令带 `-R SingularityKChen/harness-projects` 或在主检出运行）

## 1. 锁定事实（2026-11-24 观察；易失值，复核命令见括号）

| 项 | 值 |
|---|---|
| PR | 688，OPEN，draft（`gh pr view 688 --json state,isDraft`） |
| base | `main` @ `eadf490183c35d34697053c980d06c78c80638ba` |
| head（实现提交） | `c79ae9d7cef4599c625381ee0a1996caa0a5664a`；与远端 `refs/heads/docs/adr-pointer-reconcile-20261124`、本地 `git rev-parse HEAD` 一致 |
| mergeable / mergeStateStatus | `MERGEABLE` / `BLOCKED`（draft + 未评审，符合评审前状态） |
| closingIssuesReferences | 仅 #666（OPEN，`kind:docs` + `area:adr` + `area:storage`） |
| commits（base..head） | 5 个：`d34f993a` 计划 → `2f91bf92` README 策略 → `43fe0fe2` 5 篇注记 → `b2bb7963` 验证与负控 → `c79ae9d7` 结果与归档准备；无 fixup/debug 提交 |
| checks | 12/12 pass，含 `PR Fast Gate` pass（`gh pr checks 688`） |
| reviews / inline comments | 0 / 0（`gh api .../pulls/688/reviews`、`.../comments`） |
| worktree | 干净；`git status --porcelain` 空 |

本记录提交在 `c79ae9d7` 之上新增一条 `docs(review)` 提交（只含本文件）；实现提交未被修改。评审结论锚定上述实现 head。

## 2. 独立验证方法

- 从计划文件重新抽取附录 A 脚本到仓库外临时目录执行（不提交、不引用实现者日志）；GREEN 直接在 `c79ae9d7` 工作树跑。
- RED 用 `git archive eadf4901` 重建基线树到仓库外临时目录并 `git init/commit`，仅把脚本 `BASE` 指向重建提交；不复用实现者 RED 记录。
- 另写独立 python 断言（不属于交付物）核对：5 篇 base→head 纯追加、状态/日期/编号/标题零改动、11 篇未改 ADR 字节相同、写集、README 结构与段/表/列语义对应。
- 变异一律：改 worktree → 跑附录 A → `git checkout -- <file>` 恢复 → 回读 `git status --porcelain` 为空；全部变异均恢复成功。

## 3. 风险矩阵（P0–P3）

| 层 | 检查 | 结果 |
|---|---|---|
| 正确性 / 事实冻结 | 5 篇 ADR 是否只追加（base 行是 head 行前缀）、状态/日期/编号/标题是否零改动、其余 11 篇是否字节不变 | PASS：5/5 行号 0002:12、0006:9、0011:87、0015:11、0016:25 各恰 1 行差异且为前缀追加；未改 ADR 全部 `cmp` 相同 |
| 正确性 / 语义 | 5 条注记点名的段/表/列在 `001_init.sql` 是否存在且语义对应（C4 只证存在，本评审逐条人读） | PASS：见表 1（含段边界与行号） |
| 正确性 / 现行文档 | README 索引行订正、解析表与 `MIGRATIONS` 单一事实源是否一致、是否构成第二份 inventory | 基本 PASS；解析表 005 行命名错误见 P2-1 |
| 策略一致性 | 新策略 vs `PLANS.md` §4、`docs/adr/README.md` 既有规则 | 历史指针机制一致；Superseded 规则交叉引用与既有冲突见 P3-1；active 计划类别缺省见 P3-2 |
| 不变量 / 架构 | 是否触碰产品、schema、workflow、依赖边或事实所有权 | PASS：diff 仅 8 个文档文件，无产品/schema/脚本/CI 改动 |
| 测试 / 证据强度 | 附录 A 是否非恒绿、变异是否只打红对应断言、盲点是否被声明 | PASS（红→绿与 9 个变异）；3 个未覆盖盲点见 P3-3/P3-4 与 P2-1 证据 |
| 工作项 | issue scope、ExecPlan 完整性、PR 描述、标签、closingIssuesReferences、规模 | PASS；#678 预估偏差已披露（P3-5 记录） |
| 发布面 | 凭据/本机路径/账号个人信息/内部系统/保密字样、`git diff --check`、长行保留 | PASS：新增行 243 行扫描无命中；`DIFF-CHECK-OK`；`docs/adr/README.md` 3962 字符长行保持 |

**水平判定：P0 = 0，P1 = 0，P2 = 1，P3 = 5。**

## 4. 逐篇注记语义核对（表 1）

段边界由 `-- 00X_…：` 注释确定：002 = 001_init.sql:8–186，003 = 187–358，006 = 359–377。

| ADR 注记 | 被核对的主张 | 001_init.sql 证据 | 判定 |
|---|---|---|---|
| ADR-0002:12 | `003_control_facts.sql` 已并入；`sync_observation` 注释在 `-- sync_observation：` 段、`CREATE TABLE sync_observation` 之前 | 003 段 187；`-- sync_observation：` 257；`CREATE TABLE sync_observation` 269；注释语义（端口主体账本、不引用 `project_item_membership`）与该 ADR 的 Superseded 判断一致 | 对应合理 |
| ADR-0006:9 | 002 段含 `provider_binding`、`workspace_binding`、`external_identity` 当前定义 | provider_binding:38、workspace_binding:47、external_identity:88，均在 002 段 8–186 内 | 对应合理（注记额外点名 workspace_binding，属信息补充，非错误） |
| ADR-0011:87 | `006_delivery_facts.sql` 已并入 `-- 006_delivery_facts：` 段的 `delivery_fact` 表；005 仍是失效名 | 006 段 359；`-- 006_delivery_facts：` 359；`CREATE TABLE delivery_fact` 361；`MIGRATIONS = ['001_init.sql']`；005 无 DDL 的退役说明见 001_init.sql:3 与 `storage-sync.ts:67` 的 `LEGACY_COMMITTED_VERSION_MESSAGE` | 段/表对应合理；同句把 005 指向「迁移片段」的表述问题见 P2-1 |
| ADR-0015:11 | `alias` 角色在 002 段 `external_identity.role` CHECK；`-- R7 身份锚点` 注释在 003 段 `repository.external_identity_id` | `role TEXT NOT NULL CHECK (role IN ('primary', 'alias', 'historical'))`（external_identity，002 段）；`external_identity_id … -- R7 身份锚点` 在 repository（191，003 段 187–358） | 对应合理 |
| ADR-0016:25 | `003_control_facts.sql` 已并入；`provisioning_generation` 在 003 段 `execution_context`；`MIGRATIONS` 只有一项、建库仍是单事务全量执行 | execution_context:200、`provisioning_generation INTEGER CHECK`:209，均在 003 段；`MIGRATIONS` 唯一项（`migrations.ts:19`）；`migrate.ts` 以 `BEGIN IMMEDIATE` 包住全部 SQL 与账本写入 | 对应合理 |

补充：注记未使用行号（`grep -E '\.sql:[0-9]|第 ?[0-9]+ ?行'` 无命中）；每条注记恰 1 次「已并入」；注记未新增 Superseded（ADR-0002 注记中的「Superseded」是复述既有判断仍然成立，不是新覆盖；人工判定合规）。

## 5. 判别力（独立复跑与变异）

**V1 GREEN（实现 head c79ae9d7）**：附录 A 原样执行 `VERIFY-EXIT=0`；C1 5 篇、C2 恰 5 篇各 1、C3/C6 OK、C4 无输出、C5 四条通过、`size` 代码 0/1000 + 文档 249/1500、disclosure 通过、`DIFF-CHECK-OK`、`LONG-LINE 75 3962`。

**V1-RED（重建 base eadf4901 树）**：`VERIFY-EXIT=1`，命中 `C2 注记篇数`、`C3 0002/0006/0011/0015/0016`、`C5 节`、`C5 旧编号`、`C5 解析表`、`C5 索引行`——检查不是恒绿。

**变异表（V2，均在实现 head 上做、每次恢复并回读工作区干净）**

| # | 变异 | 期望 | 实测红/绿 | 归因 |
|---|---|---|---|---|
| M1 | 删 ADR-0015 注记（恢复 base 行） | C2/C3 | `VERIFY-EXIT=1`：`C2 注记篇数`、`C3 0015` | 对应断言 |
| M2 | ADR-0002 注记段名 typo：`-- sync_observation：`→`-- sync_observations：` | C4 注记段名 | `VERIFY-EXIT=1`：`C4 note segment sync_observations：` | 对应断言 |
| M3 | ADR-0002 原句旧路径改写为 `001_init.sql` | C3 非纯追加 | `VERIFY-EXIT=1`：`C3 0002` | 对应断言 |
| M4 | README 索引行回退为「迁移 006」 | C5 | `VERIFY-EXIT=1`：`C5 旧编号`、`C5 索引行` | 对应断言族 |
| M5 | ADR-0016 注记插入 `001_init.sql:209` | C4 行号 | `VERIFY-EXIT=1`：`C4 行号` | 对应断言 |
| M6 | README 解析表 005 行改为 `007_nonexistent.sql` | 应红（映射语义） | **`VERIFY-EXIT=0` 未打红** | 盲点：C5 只数 4 行与旧编号，不校验映射内容（支撑 P2-1） |
| M7 | ADR-0006 注记末句改为「Superseded by ADR-0017。」 | 应红（不得用 Superseded 语义） | **`VERIFY-EXIT=0` 未打红** | 盲点：无自动断言（P3-4） |
| M8 | 改未改动的 ADR-0009 正文（`## Decision`→`## Decision (review probe)`） | 应红（写集/历史冻结） | **`VERIFY-EXIT=0` 未打红** | 盲点：C3 只覆盖 5 篇、C7 只按 `docs/adr/` 目录前缀放行（P3-3） |
| M9 | 改越界文件 `docs/development/workflow.md`（工作区追加一行） | C7 工作区越界 | `VERIFY-EXIT=1`：`C7 工作区越界` | C7 对非 `docs/adr/` 路径有效 |

结论：附录 A 对本次 5 条注记与 README 节/表/索引的核心断言有判别力；M6–M8 暴露的盲点已分别落到 P2-1 与 P3-3/P3-4，未发现「该红不红」导致本次交付事实失真的情形（M6–M8 是检查覆盖缺口，不是本次 diff 缺陷）。

## 6. 范围、规模与发布面

- 写集：`git diff --name-only eadf4901...c79ae9d7` 恰 8 文件——`docs/adr/README.md`（+23/−1）、5 篇 ADR（各 +1/−1）、`docs/README.md`（+1/−0）、本计划（+214/−0）；与 ExecPlan Global Constraints 声明的写集完全一致，无越界、无产品/schema/workflow/tests/scripts 改动。
- 规模：`node scripts/rule-checks.mjs size origin/main` → 代码 0/1000、文档 249/1500（仓库硬上限 1000/1500 内）；#678 的 80–160 文档行预估偏差已在计划 Decision Log 与 PR body 披露（见 P3-5 的规模项，不阻塞）。
- 发布面：`git diff --check` 干净；新增 243 行人工/机械扫描无凭据、本机绝对路径、账号个人信息、内部系统、保密字样；`docs/adr/README.md` 3962 字符长行未被整文件回写（`LONG-LINE 75 3962`）。
- PR 描述含闭环、ExecPlan+Batch、Closes/Refs、真实验证证据、风险与回滚；draft 状态与「评审后 ready」流程一致；`PR Fast Gate` 已 pass。

## 7. 结论与缺陷清单

**结论：APPROVE WITH NOTES。无 P0/P1；P2 × 1、P3 × 5。** 按 `docs/review/mvp-review.md` §3 的映射（只有 P2/P3 → APPROVE），本 PR 不构成合并阻塞；P2-1 建议本 PR 内一行机械修复，P3 记录或后续 docs 清理吸收。最终合并授权仍归人类伙伴，正式 R1/人验独立。

### P0（0）
无。

### P1（0）
无。

### P2-1 README 解析表的 005 行指向从未存在过的文件名，漏掉真正被折叠的 005 片段
- 位置：`docs/adr/README.md:49`（新节解析表；同文件 :43 的表标题为「已折叠的迁移片段与现行资产…的段名对照」）
- 缺陷：该行把 `005_delivery_facts.sql` 列为「已折叠片段」，但该文件名从未在仓库中创建过；单资产折叠真正删除的 005 片段是 `005_source_version_carrier.sql`（无 DDL、纯注释退役说明）。因此表既错误分类了一个计划名，又对真实旧文件名不可解析；行内「退役说明见 001_init.sql 头注释与 LEGACY_COMMITTED_VERSION_MESSAGE」实际描述的是真实 005 载体片段，却被挂在不存在过的名字下。
- 影响：本 PR 的核心交付之一就是「旧片段 → 现行段名」的解析表；未来读者在 `git log --diff-filter=D` 中遇到 `005_source_version_carrier.sql` 时无法用该表定位，且会把 `005_delivery_facts.sql` 误认为曾有 DDL 的已折叠资产。对 `docs/adr` 历史正文无影响。
- 证据：`git log --all --oneline -- '*005_delivery_facts.sql'` 为空；`git show --name-status --format= 02f5346a` 含 `D packages/storage/sqlite/migrations/005_source_version_carrier.sql`；`git show 02f5346a^:packages/storage/sqlite/migrations/005_source_version_carrier.sql` 全为注释（无 DDL）；`001_init.sql:3` 的退役说明只提「005（版本载体历史）」；变异 M6 把该行改成 `007_nonexistent.sql` 后附录 A 仍 `VERIFY-EXIT=0`（说明该内容无语义断言）。
- 修复方向（机械、小）：把该行「旧片段」改为 `005_source_version_carrier.sql`（保留「无 DDL；退役说明见…」），并在行内或表后一句注明「`005_delivery_facts.sql` 是控制计划中从未创建的过期名，见 ADR-0011」；如愿意，可同时给 C5 加一条「表内旧文件名都出现在 `git log --diff-filter=D` 的折叠提交里或声明为未创建」的负控。

### P3-1 新策略对 Superseded 规则的交叉引用仍指向与 `PLANS.md` §4 及实际实践冲突的旧表述
- 位置：`docs/adr/README.md:36`（新节）；被引用的是 `docs/adr/README.md:8`。
- 缺陷：:8 写「被推翻的决策…在**文末**追加 `Superseded by ADR-YYYY`」；`PLANS.md:66`（§4）要求「在**原处**追加 `Superseded by …（日期）`，原文保留」，实际实践也是内联（如 `ADR-0002:12` 的 `**Superseded（2026-09-24…）**`）。新节 :36 写「被推翻的决策仍按上节规则追加」，把旧表述再次引用为现行规则，没有消歧。
- 影响：下一次被推翻的决策可能被追加到文末而非原处，冻结证据位置分裂；本 PR 声称区分两种机制，却没有消除既有矛盾。
- 证据：`git show eadf4901:docs/adr/README.md` 第 8 行；`PLANS.md:66`；`ADR-0002:12`（本 PR 未改动的原文）即内联 Superseded。计划 Surprises 3 已把它登记为「不改、避免扩大范围」，但新节新增的交叉引用使问题在新增行上再次出现。
- 修复方向：把 :36 改为引用既有实践（例如「被推翻的决策按 `PLANS.md` §4 就地标注」），或在本 PR 内一行订正 :8；二者都属小范围。若按计划保留，请在 PR 上显式说明这是已知遗留。

### P3-2 新策略未覆盖 `docs/exec-plan/active/`，本 PR 自身留下 2 行旧片段名
- 位置：`docs/adr/README.md:39`（只列「本目录索引 + docs/architecture」直接订正、「completed/ + review/」不追改）；遗留 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md:174`、`:232`（含 `002_identity_membership.sql`、`003_control_facts.sql`、`004_execution_run_identity.sql`、`005_delivery_facts.sql`、`006_delivery_facts.sql`）。
- 缺陷：策略枚举了当前/历史四类文档，却遗漏 active ExecPlan；这类文件既是当前文档又含历史批次记录，读者无法据此判断该就地订正还是视为历史。PR 的 out-of-scope 只记了 `docs/exec-plan/tech-debt-tracker.md` 的 3 行（已核实存在 3 行），没有记录这两行。
- 影响：同类歧义下一次仍会遇到；本 PR 声明的「全仓核对」结论（只 5 篇 docs/adr）与这些命中的关系未被记录。
- 证据：`grep -cE '00[2-7]_[a-z_]+\.sql' docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` = 2；`grep +nE … docs/exec-plan/tech-debt-tracker.md` = 3 行（TD-021/041/052）。
- 修复方向：给策略第 39 行补一类「active ExecPlan 的历史批次行按历史记录不追改，当前状态描述直接订正」，并在计划 Surprises/PR out-of-scope 里登记这 2 行（或直接按新策略处置）。

### P3-3 附录 A 的 C7 写集断言只按目录前缀放行，不校验 Global Constraints 声明的 6 个 ADR 文件
- 位置：`docs/exec-plan/active/2026-11-24-adr-pointer-reconcile.md:204`（附录 A 的 `SCOPE='^(docs/adr/|…)'`）。
- 缺陷：C7 的提交/工作区越界检查对 `docs/adr/` 下任意文件放行；实际写集约束是 5 篇 ADR + README 六个文件。实测修改未在写集内的 `docs/adr/ADR-0009-*` 正文后，附录 A 仍 `VERIFY-EXIT=0`。
- 影响：I6「写集」断言的强度低于计划声明；本次实际 diff 已由本评审独立核对为合规（11 篇未改 ADR 与 base 逐字节相同），所以不影响本 PR 事实，但该负控在未来复跑时抓不到同类越界。
- 证据：变异 M8（改 ADR-0009 正文）→ `VERIFY-EXIT=0`；对照 M9（改 `docs/development/workflow.md`）→ `C7 工作区越界`。
- 修复方向：把 SCOPE 收紧为 6 个精确路径，或加一条「除 5 篇外 `docs/adr/ADR-*.md` 与 base 逐字节相同」的断言（一行 `cmp` 循环）。

### P3-4 Global Constraints「注记不得用 Superseded」没有自动断言
- 位置：计划 Global Constraints「历史正文只追加…注记不得用 Superseded」；附录 A 无对应检查。
- 缺陷：C4 只查锚点/段名/行号/并入计数，不查 Superseded；实测把 ADR-0006 注记末句替换为「Superseded by ADR-0017。」后脚本仍绿。本次 5 条注记人工核对合规（ADR-0002 仅复述既有判断「仍然成立」），但约束靠人读兜底且未在「证明不了」清单里明说。
- 影响：未来注记误用 Superseded 语义时，一次性验证不会发现；ADR 状态语义可能被误读。
- 证据：变异 M7 → `VERIFY-EXIT=0`；`grep -rh '历史指针' docs/adr/ADR-*.md` 人工核对。
- 修复方向：C4 加 `grep -q 'Superseded by' <注记行>` 判红（现有注记不含该串），或把该约束显式列入计划「证明不了」清单。

### P3-5 计划自证读数与提交序列存在过期/不一致处
- 位置：`docs/exec-plan/active/2026-11-24-adr-pointer-reconcile.md` `:109`（Batch 1「C5 静默红（脚本只置失败不回显）」）、`:112`（Batch 4「文档 229/1500」）、`:124`（Surprises 8「正文实际 33 行」）、Decision Log「3 个提交」。
- 缺陷：①进 Batch 1 验证行写「C5 报 0 节/旧编号/索引未订正」，附录 A 也 `echo` 这些标签，与 `:109`「静默红」矛盾；②Surprises 8「33 行」被 Surprises 9/Outcomes 的 34 行取代，未就地标注；③Progress 的 229 与 Outcomes 的 240 是不同 head 的观察值但未统一标注观察时刻（现读 249）；④Decision Log 说整理成 3 个提交，实际分支 5 个提交。
- 影响：计划是本次唯一验证证据载体（脚本不入库）；过期读数会让复评者无法区分「当时观察」与「当前事实」。5 个提交本身各自可独立审阅、无 fixup/debug，序列不构成质量问题。
- 证据：`:109`、`:112`、`:124` 与 `:100`（Validation 表 C5 行）、Outcomes 的 240/249；`git log --oneline eadf4901..c79ae9d7` = 5。
- 修复方向：按 `PLANS.md` §4「易失状态写观察时刻 + 重算命令」统一（例如「文档 249 @ c79ae9d7」），并对 33/229/3 个提交就地加 `Superseded by …（日期）` 或改成当前值；属计划维护，不动实现。

### P3-6 规模与 #678 预估的偏差（已披露，记录备查）
- 位置：PR body「规模」段、计划 Decision Log Q2、Outcomes；#678 规划段「approximately 80–160 documentation additions+deletions」。
- 事实：实测文档 249/1500（ADR 正文 34 + docs/README 1 + 本计划 214），ADR 正文低于 80、总口径高于 160；计划与 PR 已记录偏差并说明本计划自身承载 spec/批次/验证全文，Lead 已裁决接受。
- 判定：不构成缺陷；仅记录「预估未命中但已披露」。修复方向：无（后续 docs-only 清理可只把计划正文与交付正文分开估算）。

## 8. 边界与未证明项

- 未验证：未来折叠是否会遵守新策略（无常驻检查，与 `docs/development/content-placement.md` §5 已知缺口同性质）；人类是否接受该惯例。
- 不覆盖：`docs/exec-plan/tech-debt-tracker.md` 的 3 行与 active 计划 2 行旧片段名属本 PR 明确排除/记录范围（P3-2），不作为阻塞。
- 正式 R1/人验、合并授权与 ready 后回读由人类伙伴/Lead 独立执行；本记录不构成批准，也不代行合并。
- 本记录提交会推进 PR head；实现 head `c79ae9d7` 的 checks 已锁存于 §1，记录提交后的 checks 与 head 以 `gh pr view/checks` 回读为准。

## 9. 复评（修复轮，2026-11-24；head `30cba914`）

修复提交：`74a43fa1`（解析表 005 行 + 计划读数/P3-2/P3-1）、`e12aa80e`、`30cba914`（正文规模统一为 34）。复评只锚定 `30cba914`，首轮 §1–§8 的结论与缺陷编号保留不动。

**锁定事实**：head `30cba914`（与远端分支一致），base `eadf4901`，draft，`MERGEABLE/BLOCKED`，Closes #666；分支共 9 个提交 = 5 个实现批次 + 评审记录 `9d045d4e` + 3 个修复提交。修复 diff（`9d045d4e..30cba914`）只动 2 个文件：`docs/adr/README.md`（8 行同行替换/追加）、本计划（+49/−27，现 217 行）；5 篇 ADR 与其余文件未改。文档规模 `402/1500`、代码 0/1000；`DIFF-CHECK-OK`、disclosure 通过、长行 `3962` 保持。观察时远端 checks：PR size / Disclosure / Issue policy / Verify pass，Windows Native / Browser 与 PR Fast Gate 待聚合。

**逐项复评**

| 项 | 结论 | 证据 |
|---|---|---|
| ① P2-1（解析表 005 行） | **已修复** | `docs/adr/README.md:49` 现为 `005_source_version_carrier.sql`（无 DDL、退役说明不变）；表后新增「`005_delivery_facts.sql` 是控制计划里从未创建的过期名（见 ADR-0011），不是已折叠资产」。真实折叠片段名与 ADR-0011 的过期名各归其位，无新歧义；C5 仍 4 行且绿。 |
| ② P3-5（读数/提交数） | **基本已修复**，余 1 处读数（P3-R2） | 正文 `+28/−6 = 34` 与 `git diff --numstat` 一致；`249/1500` 已标注 `@ c79ae9d7` 并说明后续提交推高总口径；「静默红」「229/240」「3 个提交」已消除，Decision Log 改为「按性质分批 + 修复轮追加、不重写已推送历史」。 |
| ③ P3-1（Superseded 交叉引用） | **已按首轮给定方案处置** | 新节①改为「按 `PLANS.md` §4 就地标注 `Superseded by …（日期）`、原文保留」；`README:8` 旧「文末」表述仍在，但已在计划 Surprises 3 就地加 `Superseded by Decision Log（2026-11-24 修复轮）` 并列入 Outcomes 遗留。残留属既有债务，本轮不新增矛盾。 |
| ④ P3-2（策略未覆盖 active 计划） | **已修复** | 策略④改为「active 计划中描述当前状态的句子直接订正；active 计划的历史批次行不追改」；`docs/exec-plan/active/2026-09-29-…:174,232` 2 行作为历史批次行记入 Surprises 13 与 Outcomes 遗留。 |
| ⑤ P3-3（C7 写集只按目录前缀） | **未处置且遗留行错位**（P3-R1） | 附录 A 的 `SCOPE` 仍放行 `docs/adr/` 前缀；复评探针 M8（改 `ADR-0009` 正文）仍 `VERIFY-EXIT=0`。计划 Outcomes 遗留写「解析表内容与 Superseded 无自动断言（rev-688 M6/M7 盲点，P3-3/P3-4 记录不修）」——M6 是 P2-1 证据，P3-3 的探针是 M8，编号错位；`证明不了` 清单也未纳入 C7 精确写集缺口。 |
| ⑥ P3-4（注记 Superseded 无断言） | **已记录不修** | 计划「证明不了」新增「注记是否误用 Superseded、解析表映射是否与真实折叠史一致（无自动断言，靠人读）」；可接受。 |

**判别力（在 `30cba914` 上独立重跑附录 A 与变异）**：GREEN `VERIFY-EXIT=0`（C1–C7、size、disclosure、diff-check、long-line 全过）。修复后变异：M1 删 ADR-0015 注记→`C2/C3`；M2 段名 typo→`C4 note segment`；M3 改写旧路径→`C3 0002`；M4 索引回退→`C5 旧编号+索引行`；M5 加行号→`C4 行号`；M9 越界改 `docs/development/workflow.md`→`C7 工作区越界`；每次 `git checkout --` 恢复且 `git status --porcelain` 为空。探针（预期绿、属已声明或不完整声明盲点）：M6 把解析表行改成 `007_nonexistent.sql` 绿；M10 把 005 行回归为 `005_delivery_facts.sql` 绿；M11 把表后「不是已折叠资产」翻成「是」绿；M8 改未在写集内的 ADR-0009 正文绿——后三者说明 P2-1 与 P3-3 的修复/结论当前**没有机器守门**（P2-1 属已声明「证明不了」，P3-3 属未记录缺口 P3-R1）。

**修复本身的范围与新问题**：修复只改 2 个文档文件，未碰 ADR 正文、产品、schema、workflow、测试或发布面；无新 P0/P1/P2。新增的两条 P3 均为记录/断言层，不改变产品与文档事实。

**复评结论：P0 = 0，P1 = 0，P2 = 0；仍余 P3 × 2。**
- **P3-R1**（沿用 P3-3 编号）：附录 A 的 C7 写集断言仍只按 `docs/adr/` 目录前缀放行，未收紧到 6 个声明文件；且计划遗留把 M6 误记为 P3-3（应为 M8），`证明不了` 清单未提该缺口。修复方向：`SCOPE` 精确列 6 路径 + 评审记录路径，或加「除 5 篇外 ADR 与 base 逐字节相同」断言；并在遗留行改正编号。
- **P3-R2**：Outcomes 写「实际 diff（`git diff --numstat origin/main`，期望 8 文件）」，但当前分支该命令输出 9 个文件（含评审记录）；应写「8 个实现文件 + 1 个评审记录」或 9，避免复评再遇同一读数不一致。
- P2-1 关闭；P3-1/P3-2/P3-4 按上述处置关闭；P3-5 关闭（余 P3-R2）。**可进入归档/ready**：无阻塞项；P3-R1/P3-R2 建议在归档提交或下一次 docs 清理中一行订正（不强制、不阻塞）。
- 复评边界：本小节锚定 `30cba914`；本次复评记录提交会再次推进 head，归档前请 Lead 以 `gh pr view/checks` 回读最终 head、base、closingIssuesReferences 与 PR Fast Gate。


## 10. 当前 head 独立 MMP 复审（2026-11-25）

### Purpose / Big Picture 与 Context and Orientation

本轮从当前 owning source 重建证据，判断 #688 是否完成 #666 的历史 ADR 可定位性闭环。评审对象固定为 `64f86c1cdbb1bf305459ad97078cd0e6b6c230df`，base 为 `main@eadf490183c35d34697053c980d06c78c80638ba`；检出 `docs/adr-pointer-reconcile-20261124`，工作树 `.worktrees/iteration12-adr-pointer-reconcile`。旧轮次结论仅作问题导航。

### Design / Spec、Global Constraints 与 Plan of Work

只写本评审记录；实现文档、代码与远端只读。先锁定远端状态，再审完整 P0–P3 矩阵、逐条核对历史/现行语义，执行精准文档验证，最后交回 findings 与建议。

| 严重度 | 核查风险 | 计划证据 | 初始状态 |
|---|---|---|---|
| P0 | 文档修改破坏主线构建、泄露发布面或越过硬约束 | 精确写集、diff、disclosure | 待核对 |
| P1 | 把历史记录改写成当前事实；生成第二资产权威；错述 schema/状态拥有者 | base 前缀冻结、SQL/manifest/事务 owning source | 待核对 |
| P2 | 映射误导读者、漏掉 issue 指针、归档/链接失效 | 五篇 ADR、折叠提交、README 索引、#666 | 待核对 |
| P3 | 验证命令、易失读数、策略措辞或证据归因不准确 | 附录 A、远端 checks/threads、规模与限制 | 待核对 |

锁定时 PR 为 OPEN、非 draft、`MERGEABLE/UNSTABLE`；11 个提交；reviews、PR comments、inline comments、review threads 均为 0（GraphQL `hasNextPage=false`）。`closingIssuesReferences` 仅 #666；该 issue OPEN，标签为 `kind:docs`、`area:storage`、`area:adr`。当前 head 的 PR Fast Gate、Verify、Browser、Windows Native、CodeQL、规则和 issue 检查通过。可选 `Create review session` 失败的 run `45410291590` 实际日志为 HTTP 404；不属于本项文档失败。


### Validation and Acceptance

在上述固定 head 的工作树根执行，未修改实现文件：

| 验证 | 命令 / 判定 | 实测 |
|---|---|---|
| 附录 A | 从 completed ExecPlan 的 `~~~~bash` 代码块抽取原文，通过 `bash` 标准输入执行 | `C3/C6 OK`、`VERIFY-EXIT=0`、进程退出 0；技术 0/1000、文档 433/1500；9 文件；长行 3962 字符保持 |
| 独立冻结检查 | Python 以 `git show eadf4901:<ADR>` 对照 16 篇现行 ADR；5 篇各一行变化，原行必须是新行前缀；另外 11 篇字节相同 | 5/5 与 11/11 通过；注记行分别 12、9、87、11、25 |
| 链接 | Python 解析改动索引、README 与计划的相对 Markdown 链接并检查实际目标 | 通过；附录 A 对全部 ADR 相对链接亦通过 |
| 现行语义 / 历史反例 | 读 `001_init.sql`、`migrations.ts`、`migrate.ts`、`storage-sync.ts`；`git show 02f5346a^:packages/storage/sqlite/migrations/005_source_version_carrier.sql`、`git log --all -- '*005_delivery_facts.sql'` | 五条注记映射正确；manifest 单项；建库同一 `BEGIN IMMEDIATE`/`COMMIT`；真实 005 仅注释；过期 005 名无历史文件 |
| 发布面 | 将当前 PR body 经 `PR_BODY` 环境传给 `node scripts/rule-checks.mjs disclosure eadf4901`；另人工核对五类目 | 退出 0；新增文档、11 条提交信息与 PR body 未见凭据、本机身份、个人信息、内部系统或保密字样 |
| whitespace | `git diff --check eadf4901...HEAD` | 退出 0 |
| 检查失败传播负控 | 原样执行附录 A，只在 `bash` 中给 `node` / `git` 定义命令替身，分别让 disclosure 返回 7、`diff --check` 返回 8，其余调用委托真实命令 | 两次均错误输出 `VERIFY-EXIT=0`、进程退出 0（F688-20261125-01） |

负控只替换调用环境，不改交付物、测试或工作树。最小复现：抽取附录 A 为变量 `script` 后，将以下任意一条函数定义置于其前并通过 `bash` 执行：

```bash
node() { if [ "$1" = scripts/rule-checks.mjs ] && [ "$2" = disclosure ]; then return 7; fi; command node "$@"; }
git() { if [ "$1" = diff ] && [ "${2:-}" = --check ]; then return 8; fi; command git "$@"; }
```

### Findings、Surprises & Discoveries 与 Decision Log

- **F688-20261125-01 / P3**：`docs/exec-plan/completed/2026-11-24-adr-pointer-reconcile.md:217–218`（均为本 PR 新增行）。附录 A 只启用 `set -u`，最后以 `FAIL` 返回；disclosure 的非零退出码没有更新 `FAIL`，`git diff --check` 失败只跳过成功提示。两项失败都会被后续成功的命令掩盖，让「唯一验证命令全文」给出错误成功信号。上表分别强制 exit 7/8 均复现退出 0。修复方向：disclosure 明确 `|| FAIL=1`，diff-check 使用 `if/else` 将失败加入 `FAIL`，保留成功提示。当前真实 disclosure 和 whitespace 已另行独立通过，因此不阻塞本轮文档交付。
- 当前风险矩阵收口：P0 无发现（纯文档、发布面通过）；P1 无发现（历史冻结、唯一 MIGRATIONS 事实源与事务主张正确）；P2 无发现（#666 指定 3 处和额外 2 篇同类遗漏均闭环、映射准确、归档链接有效）；P3 一项，如上。
- 产品/架构：本项恢复读者从历史 ADR 定位当前资产的路径，不触碰 Planning/工程状态、Provider ack、身份/持久化或依赖边；解析表明确不是第二 inventory。保持五篇同类引用一致，未引入链接框架或额外 schema 行为，设计范围适当。
- 已有追踪：GitHub `gh issue list --state all --search '"ADR" "pointer"'` 找到 #666（本项）、#596/#663（已关闭背景）及 #8/#678（较大规划）；`--search '"VERIFY-EXIT"'` 未找到记录。既有评审与技术债务记录未覆盖本次失败传播缺口。旧 README:8 的 Superseded 措辞、active 历史行和技术债务三行路径均已有明确处置，未重复列为新缺陷。
- 2026-11-25 / 独立 reviewer 决定：**APPROVE**；P0/P1/P2 = 0，P3 = 1。该建议限定上述 immutable head；不发布 review、不代行修复或合并。

### Progress、Idempotence and Recovery、Interfaces and Dependencies

- [x] 锁定当前远端、全部 review/comment/thread/check；完整 P0–P3 矩阵与逐层审查完成。
- [x] 精准文档验证、失败传播反例、issue 与已有追踪核对完成。
- [x] 只追加本轮评审记录；未修改实现文件，未提交、push 或外部写入。

依赖为 Git、gh、Python、Bash、Node 与当前仓库 owning source。验证可重复；负控无持久状态，无需回滚；评审文档追加可独立撤回。

### Outcomes & Retrospective 与 Bottom Change Note

当前文档闭环成立；交回一条可在原处机械修复的 P3。未运行全量产品测试：diff 无产品/配置/脚本变化，现行 SQL 与事务实现仅只读核对，当前 head 托管正式 lanes 已成功。未证明未来折叠遵守惯例、全部链接持续有效、人类产品接受或 R1；无常驻链接检查是既有范围决定。

2026-11-25：追加当前 head 的独立复审矩阵、精准证据和 F688-20261125-01；未更改任何旧 head 的历史结论。最终提交推进 head 后，需重新回读远端 head/base/checks/threads。


## 11. F688-20261125-01 修复独立复评（2026-11-25）

本轮对象为 `64f86c1c` 之上的未提交工作树差异（父会话只修改既有 completed ExecPlan；本评审记录尚待统一提交）。逐项读完本轮 diff：原附录仅两行改变行为，disclosure 用 `|| FAIL=1`，diff-check 用 `if/else` 更新 `FAIL`；授权、恢复引用和旧禁令的就地 Superseded 不改变产品/schema/Planning 边界。无新增 P0/P1/P2/P3。

沿用首轮仓库外同一 `pr688-command-failure-probes.py`，从当前附录原文执行：基线 `VERIFY-EXIT=0` / 进程 0；disclosure 命令替身返回 7 → `VERIFY-EXIT=1` / 进程 1；diff-check 命令替身返回 8 → `VERIFY-EXIT=1` / 进程 1。两项都由目标检查打红，其他检查保持绿；没有修改工作树实现或引入常驻测试。**F688-20261125-01 关闭，建议 APPROVE。**

当前 ADR/索引/计划/本记录相对链接、`git diff --check` 通过。原提交范围 disclosure 机械扫描通过；新增未提交 diff 另按五类目人工核对通过（机械命令不覆盖这些未提交行）。按授权仅将计划本轮 Progress 勾选并在 Outcomes 记录结果；其余实现不改。此前计数已更正为实际 11 commits，历史轮次未改。本轮未提交、push 或发布 review；最终整理后的 head、远端门禁与 issue 回读留给收尾会话。
