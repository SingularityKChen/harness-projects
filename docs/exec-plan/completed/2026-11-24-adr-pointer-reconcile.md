# 历史 ADR 指针订正 ExecPlan（#666）

> 状态：Completed（2026-11-24 归档；rev-688 复评通过）
> 创建 / 作者：2026-11-24 / Lead+rx
> 范围：Closes #666；Refs #659、Refs #664；docs-only，0 技术行
> 上游输入：issue #666；issue #678 权威规划段（80–160 文档行预估）；docs/review/pr-659-mmp-review.md P3-5；docs/review/pr-664-mmp-review.md 残余项；2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）
> 执行上下文：分支 docs/adr-pointer-reconcile-20261124，工作树 .worktrees/iteration12-adr-pointer-reconcile，基线 main@eadf4901（git rev-parse --short HEAD）

## Purpose / Big Picture

读者在历史 ADR 里遇到已删除的迁移片段文件名时，能在原句末尾读到一条带日期的历史指针注记，知道同一语义现在位于 packages/storage/sqlite/migrations/001_init.sql 的哪一段；docs/adr/README.md 写明「历史 ADR 冻结、当前文档直接订正」的规则和已折叠片段解析表，下一次资产折叠有固定动作。

最小成功证据：5 篇受影响 ADR 各恰好 1 条注记且历史行只追加；README 策略/解析表落地、索引旧编号订正；一次性验证红→绿（C1–C7），7 个变异负控各打红对应断言；技术行 0、文档总行数 ≤1300。

## Context and Orientation

- issue #666（kind:docs + area:storage + area:adr）点名 3 处：ADR-0002:12、ADR-0015:11、ADR-0016:25。要求保留历史决策、只订正当前可定位性、策略写入 docs/adr/README.md；明确不建通用链接检查框架、不改产品/schema/lane。
- 全仓核对（git grep -nE '00[2-7]_[a-z_]+\.sql' -- ':!node_modules'，main@eadf4901）发现 docs/adr/ 内共 5 篇含失效文件名：ADR-0002:12、ADR-0006:9、ADR-0011:87、ADR-0015:11、ADR-0016:25。issue 的 3 处是子集；只做 3 处会让新策略在写下当天即被自身违反。
- 现行唯一 SQL 资产：001_init.sql（377 行，2026-11-24 读数）；MIGRATIONS 唯一项（packages/storage/sqlite/src/migrations.ts:19），测试钉住单资产（tests/integration/harness-plugin-migrations.test.js:21）。折叠提交 02f5346a（2026-11-17，Refs #596），归档计划 docs/exec-plan/completed/2026-11-17-storage-single-asset.md。
- 注记引用的语义锚点（001_init.sql 内各恰 1 次，C4 机械验证）：段注释 -- 002_identity_membership：、-- 003_control_facts：、-- 006_delivery_facts：、-- sync_observation：、-- #305：；external_identity.role 的 CHECK、-- R7 身份锚点、repository.external_identity_id、execution_context.provisioning_generation、delivery_fact 表。重算见附录 A 的 anchor 循环。
- 既有规则：PLANS.md §4 要求「被推翻的结论就地标注、原文保留」；docs/adr/README.md:8 写「被推翻的决策文末追加 Superseded by ADR-YYYY」，实际实践是就地内联。两种标记只覆盖「决策被推翻」与「事实订正」，没有「决策不变、仅引用的资产消失」这一类，#666 补的正是这个空档。
- 无自动回归：tests/ 与 scripts/ 不解析 ADR 文本（git grep -l 'docs/adr' -- tests scripts 为 0）；仓库没有链接检查（docs/development/content-placement.md §5 已登记缺口）。本项只能一次性命令 + 评审。
- 来源：docs/review/pr-659-mmp-review.md:50 P3-5；docs/review/pr-664-mmp-review.md:29,50,63 把残余指针转给 #666。
- 当前文档的失效读数：docs/adr/README.md:46 索引行仍写「迁移 006 的 delivery_fact」；同文件 :53 是一条 3962 字符的长行（禁止整文件回写，见 Batch 2）。
## Design / Spec

选定：历史正文冻结 + 每篇 1 条就地追加的日期注记 + README 策略与解析表 + 索引行订正。

1. **5 篇各 1 条注记，内联追加在指针所在行末**（不新增行、不改动既有字符）。固定 token 为 **历史指针（日期，#issue）**，末句固定「原文保留，决策不变。」。5 条定稿文本（实施时逐字采用，勿改写措辞）：
   1. ADR-0002:12 追加：**历史指针（2026-11-24，#666）**：#596 单资产折叠（2026-11-17）后，本句引用的 003_control_facts.sql 已并入 packages/storage/sqlite/migrations/001_init.sql，该注释现在位于其中 -- sync_observation： 段（CREATE TABLE sync_observation 之前）；2026-09-24 的 Superseded 判断仍然成立。原文保留，决策不变。
   2. ADR-0006:9 追加：**历史指针（2026-11-24，#666）**：#596 单资产折叠（2026-11-17）后，本段引用的 002_identity_membership.sql 已并入 packages/storage/sqlite/migrations/001_init.sql，provider_binding、workspace_binding 与 external_identity 的当前定义见其中 -- 002_identity_membership： 段。原文保留，决策不变。
   3. ADR-0011:87 追加：**历史指针（2026-11-24，#666）**：#596 单资产折叠（2026-11-17）后，006_delivery_facts.sql 已并入 packages/storage/sqlite/migrations/001_init.sql 的 -- 006_delivery_facts： 段（delivery_fact 表），本句的并入义务按当前资产形状已成立；本 ADR 中的「迁移 006」按同一段解析，005_delivery_facts.sql 仍是失效名称（005 的载体历史见 001_init.sql 头注释的退役说明）。原文保留，决策不变。
   4. ADR-0015:11 追加：**历史指针（2026-11-24，#666）**：#596 单资产折叠（2026-11-17）后，本段引用的 002_identity_membership.sql 与 003_control_facts.sql 已并入 packages/storage/sqlite/migrations/001_init.sql；alias 角色见其中 -- 002_identity_membership： 段的 external_identity.role CHECK，-- R7 身份锚点 注释见 -- 003_control_facts： 段的 repository.external_identity_id。原文保留，决策不变。
   5. ADR-0016:25 追加：**历史指针（2026-11-24，#666）**：#596 单资产折叠（2026-11-17）后，本段引用的 003_control_facts.sql 已并入 packages/storage/sqlite/migrations/001_init.sql（provisioning_generation 列见其中 -- 003_control_facts： 段的 execution_context 表）；「七份 SQL」是折叠前的资产形状，现行 MIGRATIONS 只有 001_init.sql 一项，建库仍是单事务全量执行，本段「没有第八份迁移、兼容 ALTER 或自动数据搬迁」的判断不变。原文保留，决策不变。
2. **README 新增 ## 历史指针与已折叠片段**（插在 ## 命名与格式 与 ## 索引 之间，21 行）：导语一句（ADR 是写作当日记录，资产消失时不改原句、就地追加）；6 条规则 —— ①与 Superseded by 的区别（只订正物理坐标，不改决策/状态/采纳）；②触发（以文件名引用的资产已不存在；迁移编号只是序数标签）；③写法与位置（原句末尾就地追加、不打断列表、同类多指针共用一条、末句固定、不写行号）；④只覆盖历史 ADR（README 索引与 docs/architecture/ 描述现在、直接订正；completed 与 review 不追改）；⑤新写 ADR 引用现行文件并点名段名；⑥不做常驻链接检查（content-placement.md §5 缺口保持原状）。解析表 4 行：002→-- 002_…： 段；003→-- 003_…： 段（004 两条 ALTER 在段末）；005→`005_source_version_carrier.sql` 无 DDL（退役说明见头注释与 LEGACY_COMMITTED_VERSION_MESSAGE；`005_delivery_facts.sql` 是控制计划从未创建的过期名，不列入）；006→-- 006_…： 段（007 以 -- #305： 标记）。权威清单声明为 MIGRATIONS，表只描述历史→段名映射。
3. **README 索引订正**：（迁移 006 的 delivery_fact）→（001_init.sql 的 delivery_fact 表）。README 是当前文档，不是历史引文。

放弃的方案：A「就地改写路径为 001_init.sql」——把「当时在 003」改成「在 001」，制造事后状态写进事前判断（违反 PLANS.md §4 与折叠计划 D8「历史记录是当日证据」），且路径存在会让检查 false-green；C「只改 README 映射」——读者在 ADR 处仍撞死链，不满足 reconcile；新 ADR-0017 记录策略——issue 指定写 README，且惯例可逆、不够 ADR 判据；提交常驻检查脚本——issue 明令不做框架且本项 0 技术行；给全部 16 篇批量加注或追改 completed/review——扩大历史面、淹没证据。

不变量：I1 历史冻结（5 篇 base 行均为 head 行前缀，C3）；I2 每篇恰 1 条（C2）；I3 决策态不变（状态行/日期/编号零 diff，由 C3 覆盖）；I4 注记只说真话（路径存在、10 个锚点各恰 1 次、无行号，C4）；I5 当前文档与现行资产一致（README 无旧编号、索引含 001_init.sql，C5）；I6 写集与预算（C7）；I7 可逆（revert 后 ADR 字节同 base）。

## Global Constraints

- **写集（唯一声明）**：docs/adr/README.md、docs/adr/ADR-0002-…md、ADR-0006-…md、ADR-0011-…md、ADR-0015-…md、ADR-0016-…md（6 文件）+ 本计划 docs/exec-plan/completed/2026-11-24-adr-pointer-reconcile.md + docs/README.md 的本计划两行索引（归档时从 Active 移到 Completed）。评审记录 docs/review/pr-<n>-mmp-review.md 由 reviewer 写（C7 白名单放行该路径）。技术文件 0。
- **不做**：不改 docs/exec-plan/tech-debt-tracker.md（历史证据行，相邻发现只记入本计划）、不追改 docs/exec-plan/completed/** 与 docs/review/**、不改 PLANS.md/AGENTS.md、不建链接检查框架、不新增 ADR、不碰产品/schema/workflow/tests/scripts。
- 历史正文只追加：不改写 Decision/Why/Rejected/Consequences，不改状态行（Proposed/Accepted）、日期、来源、编号与标题；注记不得用 Superseded。
- 文档中文正文、英文标题；路径与命令英文；不写本机绝对路径、运行态内容、凭据或内部系统（disclosure）。
- 不写 Project Status/blocked-by/blocking、不改 issue 正文、不合并 PR；PR 只由 Lead 建/写。**Superseded by Decision Log（2026-11-25）**：当前用户已指定本评审会话收尾 #687–#689，授权核对/处理对应 issue 与条件 rebase merge；Planning 字段仍不写。
- 规模：技术 0/800；文档 ≤1300 硬上限；#678 的 80–160 预估按实记录偏差（正文实测见 Outcomes，含本计划总口径约 250 行）。
- 并行写边界：#679 拥有 .github/workflows/、tests 与 docs/development/ci.md；#313 拥有 docs/development/**；本 PR 只改 docs/adr/，无文件冲突。
## Plan of Work

### Batch 1 · 基线与 RED 取证
**最小闭环**：在 worktree 记录基线 sha 与 RED 输出，证明检查不是恒绿。
**涉及文件**：本计划。
步骤：git fetch origin main；git rev-parse --short HEAD；跑 C1/C2 并保存改动前输出；把附录 A 脚本保存到仓库外临时位置运行（不提交）。
**验证**：C1 输出 5 条路径；C2 无输出；脚本 VERIFY-EXIT=1，C3 报 5 篇缺追加、C5 报 0 节/旧编号/索引未订正、size 文档 <1300（此时只有本计划）。
**回滚**：无写入。

### Batch 2 · README 策略、解析表、索引订正
**最小闭环**：README 新节与索引行落地，ADR 仍原样（C3 仍红）。
**涉及文件**：docs/adr/README.md。
步骤：用锚点 edit（禁止整文件回写，见 Surprises 4）：把 ## 索引 替换为新节 + 空行 + ## 索引；把索引行旧片段替换为现行资产表述。
**验证**：C5 三条通过；awk 'length($0)>3900' docs/adr/README.md 恰 1 行 3962；diff 只有 README（约 +22/−1）。
**回滚**：git checkout -- docs/adr/README.md。

### Batch 3 · 5 篇 ADR 追加注记
**最小闭环**：按 Design 1 的 5 条文本逐篇在指针行尾追加，每篇 +1/−1。
**涉及文件**：docs/adr/ADR-0002-…md、ADR-0006-…md、ADR-0011-…md、ADR-0015-…md、ADR-0016-…md。
步骤：每篇用「行内唯一旧句 + 追加文本」的锚点 edit（old→old+note），逐篇 git diff --word-diff 目视确认只有追加。
**验证**：C2 恰 5 行且每行 1；C3 输出 C3/C6 OK；C4 无输出；git diff --numstat 每篇 1 1。
**回滚**：逐篇 git checkout -- <file>。

### Batch 4 · 全量验证与变异负控
**最小闭环**：C1–C7 全绿，变异 M1–M7 各只打红预期断言；记录 GREEN 输出（见 Validation）。
**涉及文件**：无新增（变异后必须恢复）。
步骤：跑验证脚本；依次做 M1–M7，每次 git checkout -- <file> 恢复；git status --porcelain 白名单回读。
**验证**：VERIFY-EXIT=0；size 报技术 0/1000、文档 <1300（其中 ADR 与 README 正文约 +34）；disclosure 机械扫描通过；git diff --check 空；LONG-LINE <行号> 3962（行号为观察值，重算即 awk）。
**回滚**：git checkout -- docs/adr；未推送时可 git reset --hard origin/main。

### Batch 5 · 独立验收、归档与 ready 准备
**最小闭环**：独立对抗验收记录完成、修复复评通过、计划归档、PR 回读后 ready。
**涉及文件**：本计划（移 completed/）、docs/README.md（只移动本计划索引行）、docs/review/pr-<n>-mmp-review.md（reviewer）。
步骤：reviewer 按 P0–P3 审 diff/锚点/预算/发布面并写记录；修复后复评；整理既有提交序列，不重写已推送历史（**Superseded by Decision Log（2026-11-25）**：当前授权按恢复引用与精确 lease 整合）；归档时移动计划与 docs/README.md 两行索引，并收紧 C7 写集断言；Lead 回读 head/base/checks/closingIssuesReferences/threads 并 ready，本 agent 不写 GitHub。
**验证**：gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences（含 666）；gh pr checks <n> 期望 PR Fast Gate pass；最终 head 重跑 size/disclosure。
**回滚**：revert 提交；计划移回 active/；无运行态副作用。

## Validation and Acceptance

**判定证据**：附录 A 是唯一验证命令全文（一次性脚本；在检出 docs/adr-pointer-reconcile-20261124 的工作树根运行，BASE=origin/main @ eadf4901）。本文写作时已在临时副本上实跑 RED 与 GREEN（2026-11-24 独立设计评审与 Lead 裁决，结论见 Decision Log）。

| 断言 | 期望输出（GREEN） | RED（改动前） |
|---|---|---|
| C1 受影响集合 | 5 条路径（0002/0006/0011/0015/0016） | 同左（基线事实） |
| C2 注记计数 | 5 行、每行计数 1 | 无输出 |
| C3 历史行只追加 | C3/C6 OK | 5 篇报缺追加 |
| C4 锚点与路径 | 10 个锚点各 1；注记点名的段名都存在；每篇注记恰 1 次「已并入」；无行号 | 无注记，不触发 |
| C5 README | 1 节、4 行表、无旧编号、索引含现行资产 | 0 节、旧编号、索引未订正 |
| C6 相对链接 | C6 OK | 同左 |
| C7 改动集/规模 | 提交与工作区改动都在写集内；技术 0/1000；文档 <1300（其中 ADR 与 README 正文约 +34）；DIFF-CHECK-OK | 文档 0/1500 |
| 脚本退出 | VERIFY-EXIT=0 | VERIFY-EXIT=1 |

**变异负控**（每条只应打红对应断言，随后恢复）：M1 删 ADR-0015 注记→C2/C3；M2 把 ADR-0002 注记里的 -- sync_observation： 写成 -- sync_observations：→C4 注记段名；M3 把 ADR-0002 原句旧路径改成 001_init.sql→C3 非纯追加；M4 索引行改回「迁移 006」→C5；M5 注记加 001_init.sql:257→C4 行号；M6 改 docs/development/workflow.md→C7 工作区越界；M7 给 ADR-0008 多加一条注记→C2 非受影响篇计数 1；M8 改未在写集内的 docs/adr/ADR-0009 正文→C7 提交/工作区越界（精确写集收紧后）。

**只能远端证明**：最终 head 的 PR Fast Gate、closingIssuesReferences 含 666、评审接受；Create review session 是已知环境性红，不作为文档失败证据。**证明不了**：注记语义是否与锚点一一对应（需 reviewer 人读 C4 输出）；未来折叠会遵守策略（无自动化，与 content-placement.md §5 同性质）；注记是否误用 Superseded、解析表映射是否与真实折叠史一致（无自动断言，靠人读）；人类是否接受本惯例。

## Progress

- [x] 2026-11-25 F688-20261125-01：原附录归集 disclosure/diff-check 失败；独立复评沿用同一负控，基线退出 0、两失败探针退出 1，当前链接与 diff-check 通过，无新增 P0–P3。

- [x] 2026-11-24 Batch 1 基线/RED 取证：HEAD d34f993a、BASE eadf4901；C1 5 条、C2 空、C3 5 篇缺追加、C5 旧编号/索引行未订正（当时脚本尚无失败标签，Batch 4 补齐）、C6 OK、size 文档 <1300（当时只有本计划）、VERIFY-EXIT=1；证据在仓库外临时日志（不提交）。
- [x] 2026-11-24 Batch 2 README 策略/解析表/索引：新增「历史指针与已折叠片段」21 行节（6 条规则 + 4 行解析表 + 权威清单声明）、ADR-0011 索引行改为 001_init.sql；C5 三条通过、C6 OK、LONG-LINE 75 3962 保持、README +23/−1（修复轮为同行替换，行数不变；终值见 Outcomes）。
- [x] 2026-11-24 Batch 3 5 篇注记：按 Design 1 定稿文本逐篇在原句行尾追加，每篇 +1/−1；C2 恰 5 篇各 1、C3/C6 OK、C4 无行号、VERIFY-EXIT=0（C4 段名断言见 Surprises 10 与 Batch 4）。
- [x] 2026-11-24 Batch 4 全量验证与 M1–M7：GREEN VERIFY-EXIT=0（size 技术 0/1000、文档 <1300、disclosure 通过、DIFF-CHECK-OK、LONG-LINE 75 3962）；负控 M1→C2/C3、M2→C4 注记段名、M3→C3、M4→C5 旧编号+索引行、M5→C4 行号、M6→C7 工作区越界、M7→C2 注记篇数；每次恢复后工作区仅剩本计划改动。
- [x] 2026-11-24 Batch 5 独立验收/归档/ready：rev-688 首轮 APPROVE WITH NOTES → 修复轮复评通过（P0/P1/P2 = 0，余 P3-R1/P3-R2）；归档提交移动计划与 docs/README.md 两行索引、把 C7 收紧为精确写集、文件数改为 9；ready 与最终 PR 回读由 Lead 执行。

## Surprises & Discoveries

- 2026-11-25：本轮 P3 的两个命令替身分别返回 7/8，旧附录均 `VERIFY-EXIT=0`；真实检查成功不代表失败传播成立。修复与独立复评见 `docs/review/pr-688-mmp-review.md` 当前轮。

1. issue 点名 3 处，docs/adr/ 实际 5 篇（grep 证据）；范围裁决取 5，否则新策略生来被违反。
2. docs/adr/README.md:46 的「迁移 006」是当前文档的失效引用，不是历史记录，应直接订正（与 ADR 正文相反处置）。
3. docs/adr/README.md:8 写「文末 Superseded」与 PLANS.md §4 及实际就地实践不一致；本 PR 只在策略里区分两种机制，不改该行（避免扩大范围）。**Superseded by Decision Log（2026-11-24 修复轮）**：:8 仍未改，但新节①的交叉引用改为「按 `PLANS.md` §4 就地标注」，不再复述旧表述（rev-688 P3-1）。
4. docs/adr/README.md:53 是 3962 字符单行；2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）阶段的演练显示「整文件读取→回写」会把该行截断。本计划因此强制锚点 edit + awk length>3900 双保险。
5. 仓库无 ADR 文本消费者、无链接检查命令；一次性脚本 + 人读是唯一可行证据，已接受为已知缺口。
6. docs/exec-plan/tech-debt-tracker.md 另有 3 行失效路径；按 Lead 裁决为历史证据行，不纳入本 PR、不新开 issue，只在 Surprises 与 PR body 的 out-of-scope 记录（见 Decision Log）。
7. 注记初稿演练出现重复从句，纯存在性检查漏过；C4 因此加「并入陈述恰一次」断言后红→绿，证明检查有判别力。
8. 设计阶段估正文 33 行（内联注记按增删之和计 10 行、README 压缩到 22 行）；**Superseded by Outcomes & Retrospective（2026-11-24 终值）**：实施后 docs/adr 正文约 +28/−6 = 34 行，Lead 裁决接受偏差、不凑行（见 Decision Log）。
9. README 实际 +23/−1（节 22 行 + 索引行 1 行替换），比计划的「约 +22/−1」多 1 行：节与「## 索引」之间需要一个空行；修复轮为同行替换与同行追加，行数不变（终值见 Outcomes）。
10. 附录 A 的 C4 只校验 001_init.sql 锚点存在与注记不含行号，不校验注记点名的段名存在，因此 M2「把段名写错」打不红；Batch 4 前补一条「注记中的 `-- NNN_xxx：` 段名都存在于 001_init.sql」断言（见 Decision Log）。
11. 负控首轮暴露两处非目标红：M1 删注记会连带打红聚合「并入计数」，M7 加一条无「已并入」从句的注记也打红同一断言。改为逐篇「恰 1 次」并把 M7 注记改成真实形状后，M1 只红 C2/C3、M7 只红 C2；M4 同时打红 C5 的「旧编号」与「索引行」两条子断言，属同一 C5 断言族。
12. rev-688 P2-1：解析表原把 `005_delivery_facts.sql` 列为已折叠片段，但该文件从未存在；真实折叠片段是 `005_source_version_carrier.sql`（`git show --name-status --format= 02f5346a` 有 `D`，内容全为注释、无 DDL；`git log --all -- '*005_delivery_facts.sql'` 为空）。已改表格行并在表后声明该名为控制计划从未创建的过期名。
13. rev-688 P3-2：docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md:174,232 另有 2 行旧片段名；作为 active 计划的历史批次记录不追改，策略④已补该类，PR out-of-scope 记录（与 Q1 的 tech-debt-tracker 3 行同性质）。
14. rev-688 复评 P3-R1/P3-R2：C7 只按 `docs/adr/` 前缀放行的探针（改 ADR-0009 正文）仍绿；归档提交把白名单收紧为精确写集（6 个 docs/adr 文件 + 本计划 + 评审记录 + docs/README.md），并加入 M8 负控；Outcomes 文件数由 8 改为 9（8 实现 + 1 评审记录）。

## Decision Log

- 2026-11-25 / 人类伙伴、本评审会话：用户点名 #687–#689 并直接授权「你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并」，并要求「清理本地和远端相关 branch、worktree 和评审过程中产生的测试文件和中间结果」。本会话承担三条 PR 的收尾；只在无 P0/P1、修复独立复评通过、当前 head 门禁通过后逐条合并，不改 Planning Status 或依赖关系。每 PR 整理为一个能力提交；先建并回读 `refs/backup/pr688-before-mmp-review-20261125` 与包含待交付完整树的 `refs/backup/pr688-final-tree-20261125`，再整理已推送历史并以精确旧 head lease 发布。串行更新到真实 main、保留全部索引，最终回读 head/base/checks/threads 与双向 issue 关联。
- 2026-11-25 / 本评审会话：F688-20261125-01 的根因是两个末尾检查的退出码未进入唯一汇总状态；在原附录显式归集失败，不引入检查框架或常驻测试。沿用同一命令替身负控判定修复，当前真实文档检查独立通过。

- 2026-11-24 / Lead：范围取 docs/adr/ 全部 5 篇 + README 策略/解析表 + 索引订正；issue 的 3 处是示例。
- 2026-11-24 / Lead：历史正文冻结；不改写为 001_init.sql；注记与前缀规则（Superseded）区分。
- 2026-11-24 / Lead：不改 tech-debt-tracker.md、不建检查框架、不碰产品/工作流、不写 Project Status。
- 2026-11-24 / rx：注记采用内联追加而非独立块引用行——ADR-0011 的指针在列表项内，块引用会打断列表或被迫远离指针；内联与既有 **Superseded（日期）** 实践一致；冻结证据改用「base 行是新行前缀」（比 numstat 删列=0 更强，能抓任何改写）。
- 2026-11-24 / rx：固定 token 历史指针（YYYY-MM-DD，#N），末句固定「原文保留，决策不变。」，锚点不写行号（易失状态，PLANS.md §4）。
- 2026-11-24 / rx：解析表 4 行覆盖 002/003/005/006（007 以 -- #305： 标注），权威清单声明为 MIGRATIONS，避免第二份 inventory；不提交常驻检查脚本（issue 0 技术行）。
- 2026-11-24 / rx：恢复/验证用一次性脚本 + 7 个变异负控；脚本不入库、不进入 PR，验证设计见 2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）。
- 2026-11-24 / rx：写集为 docs/adr 6 文件 + 本计划 + docs/README.md 本计划索引行；评审记录由 reviewer 写；提交按性质分批（计划 / README 策略 / 5 篇注记 / 验证负控 / 结果与归档准备），已推送历史不重写（禁止 force-push），修复轮追加提交。**Superseded by Decision Log（2026-11-25）**：当前用户要求整合提交；仅在两份恢复引用和精确 lease 保护下整理本 PR 历史。
- 2026-11-24 / Lead：Q1 tech-debt-tracker.md 的 3 行失效路径不纳入本 PR、不新开 issue，只在 Surprises 与 PR body 的 out-of-scope 记录，避免同一清理出现第二个待办源。
- 2026-11-24 / Lead：Q2 接受正文规模（设计阶段估约 33 行，最终实测见 Outcomes）与 #678 的 80–160 预估的偏差、不凑行；归档批次只把本计划索引行从 docs/README.md 的 Active 表移到 Completed 表，不改其他行。
- 2026-11-24 / Lead：rev-688 复评通过（P0/P1/P2 = 0，余 P3×2 不阻塞），批准归档；ready 与最终 PR 回读由 Lead 统一执行。
- 2026-11-24 / rx：Batch 4 前加强 C4 与 C7——C4 增加「注记点名的段名都存在」与「每篇恰 1 次『已并入』」，C7 增加写集白名单与 size 预算断言；否则 M2 与 M6 打不红，验证会静默绿（见 Surprises 10）。

## Idempotence and Recovery

- 所有编辑用「唯一锚点」替换：锚点不存在或已追加时 edit 失败而不是静默重复，可安全重试。
- 验证脚本只读；可任意重复。变异步骤必须先 git checkout -- <file> 恢复，再跑一次 C1–C7 回到 GREEN。
- 未推送失败：git reset --hard origin/main。已推送：先建 backup ref，再按 AGENTS.md §6 精确 force-with-lease。合入后回滚：git revert <sha>，ADR 字节恢复 base 原样（纯追加）。
- 无数据库/工作树/外部 Provider 状态需要恢复。

## Interfaces and Dependencies

- 工具：git、bash、node（scripts/rule-checks.mjs）、python3（一次性断言）、gh -R SingularityKChen/harness-projects；无网络/凭据依赖。
- 事实依赖：main@eadf4901；MIGRATIONS 单资产；001_init.sql 段注释与列；docs/development/content-placement.md §5 已知缺口。
- 写作边界：本 PR 与 #679/#313 文件集不重叠；docs/README.md 只动本计划索引行，其他行不改。

## Outcomes & Retrospective

2026-11-25 修复复评：F688-20261125-01 已关闭。原附录正常路径退出 0，disclosure 返回 7 与 diff-check 返回 8 的同一命令替身现均汇总为 `VERIFY-EXIT=1`、退出 1；修复差异、当前链接与发布面人工核对通过。仅原附录两行改变检查行为，无新增常驻脚本；最终提交与远端门禁仍由收尾会话执行。

归档（2026-11-24）：本计划移入 docs/exec-plan/completed/，docs/README.md 只移动本计划两行；终值与残余项如下。

- 交付：docs/adr/README.md 策略节 + 4 行解析表 + 索引行订正；5 篇历史 ADR 各 1 条就地注记；本计划与 docs/README.md 的本计划索引行。
- 实际 diff（`git diff --numstat origin/main`）：终值 9 文件 = 8 个实现文件（docs/adr 6 + docs/README.md + 本计划）+ 1 个评审记录 docs/review/pr-688-mmp-review.md（reviewer 写）；docs/adr 正文 +28/−6 = 34 行（设计阶段估 33 行；P2-1 修复为同行替换与同行追加，行数不变）。
- 规模：`node scripts/rule-checks.mjs size origin/main` 期望技术 0/1000、文档 <1300；归档前读数 0/1000、402/1500 @ 30cba914（含评审记录 150 行；归档提交只动本计划与两行索引，易失值以命令重算为准）。
- 与 #678 的 80–160 预估：docs/adr 正文 34 行低于 80；含计划与索引的总口径约 250 行（不含评审记录）高于 160。差异主要来自本计划自身（承载 spec、批次与验证全文）；Lead 已裁决接受（见 Decision Log）。
- 验证：附录 A 一次性脚本归档后复跑 GREEN（VERIFY-EXIT=0）；M1–M8 各自打红对应断言后恢复；disclosure 机械扫描与人工五类目通过；`git diff --check` 干净；LONG-LINE 75 3962 保持。
- 评审结论：rev-688 首轮 APPROVE WITH NOTES（无 P0/P1），P2-1/P3-5 修复后复评通过（P0/P1/P2 = 0），余 P3-R1/P3-R2 在归档提交处置：C7 收紧为精确写集、文件数改为 9。
- 遗留：docs/exec-plan/tech-debt-tracker.md 的 3 行与 active 计划 2 行旧片段名按裁决不追改（Q1/P3-2）；docs/adr/README.md:8 的「文末 Superseded」旧表述未改（P3-1，仅在新节消歧）；解析表映射内容与「注记不得用 Superseded」无自动断言（rev-688 M6/M10/M11 与 M7，属已声明「证明不了」的 P2-1/P3-4）；未来折叠遵守策略无自动化保证（与 content-placement.md §5 同性质）；ready 与最终 PR 回读由 Lead 执行。

## Bottom Change Note

- 2026-11-25 / 本评审会话：按独立 P3 在原附录归集检查失败；记录点名收尾授权、恢复引用、提交整理与逐当前版本合并门。归档保持，修复证据见本轮评审记录。

- 2026-11-24 / Lead+rx：创建。收敛 2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）；两种设计均已在临时副本演练到 GREEN，本稿取全集范围与就地注记 + 解析表机制。
- 2026-11-24 / Lead+rx：按 Lead 裁决（见 Decision Log）清理仅评审用的附录与本地运行态路径引用，状态改为 Active（Lead 已批准执行）；docs/README.md 本计划索引行改由本分支维护。
- 2026-11-24 / rx：Batch 4 前加强附录 A 的 C4/C7 并同步 Validation 表与 M2/M6 描述；理由见 Decision Log 与 Surprises 10。
- 2026-11-24 / rx：填写 Outcomes & Retrospective 并把 Batch 5 标为归档准备完成（计划仍留 active/，待独立验收与 PR 回读后再归档）。
- 2026-11-24 / rx：按 rev-688 修复 P2-1（解析表 005 行改为 `005_source_version_carrier.sql` 并声明未创建的过期名）、P3-5（统一读数与提交序列）、P3-2（策略补 active 计划类别）与 P3-1（新节引用 PLANS.md §4 就地标注）；Surprises 12/13 记录。
- 2026-11-24 / rx：归档——计划移入 docs/exec-plan/completed/、docs/README.md 两行索引移动、C7 收紧为精确写集（修 P3-R1）、Outcomes 文件数改为 9（修 P3-R2）；Progress 勾选 Batch 5。

## 附录 A · 一次性验证脚本（约 40 行）

~~~~bash
#!/usr/bin/env bash
# 一次性验证：在检出 docs/adr-pointer-reconcile-20261124 的工作树根运行（BASE=origin/main @ eadf4901）
set -u; BASE=origin/main; FAIL=0
git grep -lE '00[2-7]_[a-z_]+\.sql' -- 'docs/adr/ADR-*.md' | sort
for f in docs/adr/ADR-*.md; do printf '%s\t%s\n' "$(grep -c '\*\*历史指针（' "$f")" "$f"; done | grep -v '^0'
[ "$(git grep -lE '00[2-7]_[a-z_]+\.sql' -- 'docs/adr/ADR-*.md' | wc -l | tr -d ' ')" = 5 ] || FAIL=1
[ "$(for f in docs/adr/ADR-*.md; do grep -c '\*\*历史指针（' "$f"; done | grep -vc '^0$')" = 5 ] || { echo "C2 注记篇数"; FAIL=1; }
python3 - "$BASE" <<'PY' || FAIL=1
import subprocess,sys,pathlib,re,urllib.parse
base,root=sys.argv[1],pathlib.Path.cwd(); bad=[]
for n in ["0002-membership-identity-separate-from-content","0006-connection-anchor-and-workspace-mount","0011-delivery-facts-last-confirmed-snapshot","0015-repository-references-side-by-side","0016-start-work-owner-generation"]:
    p="docs/adr/ADR-"+n+".md"; b=subprocess.run(["git","show",base+":"+p],capture_output=True,text=True,check=True).stdout.split("\n"); h=(pathlib.Path(root)/p).read_text(encoding="utf-8").split("\n")
    d=[i for i in range(len(b)) if b[i]!=h[i]] if len(b)==len(h) else []
    if len(d)!=1 or not h[d[0]].startswith(b[d[0]]): bad.append("C3 "+n)
miss=[t for p in sorted((pathlib.Path(root)/"docs/adr").glob("*.md")) for t in re.findall(r"\[[^\]]*\]\(([^)]+)\)",p.read_text(encoding="utf-8")) if not (lambda v: v.scheme or v.netloc or not v.path or (p.parent/urllib.parse.unquote(v.path)).exists())(urllib.parse.urlsplit(t.strip().split(" ")[0].strip("<>")))]
print("C3/C6 OK" if not bad and not miss else "\n".join(bad)+str(miss)); sys.exit(1 if bad or miss else 0)
PY
for a in '-- sync_observation：' 'CREATE TABLE sync_observation' '-- 002_identity_membership：' '-- 003_control_facts：' '-- 006_delivery_facts：' 'CREATE TABLE delivery_fact' 'CREATE TABLE execution_context' '-- R7 身份锚点' "role IN ('primary', 'alias', 'historical')" 'provisioning_generation INTEGER CHECK'; do [ "$(grep -cF -- "$a" packages/storage/sqlite/migrations/001_init.sql)" = 1 ] || { echo "C4 anchor $a"; FAIL=1; }; done
grep -rh '\*\*历史指针（' docs/adr/ADR-*.md | grep -qE '\.sql:[0-9]|第 ?[0-9]+ ?行' && { echo "C4 行号"; FAIL=1; }
for a in $(grep -rhoE -- '-- [a-z0-9_]+：' docs/adr/ADR-*.md | sort -u); do grep -qF -- "$a" packages/storage/sqlite/migrations/001_init.sql || { echo "C4 note segment $a"; FAIL=1; }; done
while IFS= read -r line; do [ "$(printf '%s' "$line" | grep -o '已并入' | wc -l | tr -d ' ')" = 1 ] || { echo "C4 并入计数"; FAIL=1; }; done < <(grep -rh '\*\*历史指针（' docs/adr/ADR-*.md)
[ "$(grep -c '^## 历史指针与已折叠片段' docs/adr/README.md)" = 1 ] || { echo "C5 节"; FAIL=1; }
grep -qE '迁移 00[2-7]' docs/adr/README.md && { echo "C5 旧编号"; FAIL=1; }
[ "$(grep -c '^| .00[2-7]_' docs/adr/README.md)" = 4 ] || { echo "C5 解析表"; FAIL=1; }
[ "$(grep '^| \[ADR-0011\]' docs/adr/README.md | grep -c '001_init.sql.*delivery_fact')" = 1 ] || { echo "C5 索引行"; FAIL=1; }
git diff --numstat "$BASE"...HEAD; git diff --name-only "$BASE"...HEAD
ALLOW1='^(docs/README\.md|docs/exec-plan/completed/2026-11-24-adr-pointer-reconcile\.md|docs/review/pr-688-mmp-review\.md)$'
ALLOW2='^docs/adr/(README\.md|ADR-0002-membership-identity-separate-from-content\.md|ADR-0006-connection-anchor-and-workspace-mount\.md|ADR-0011-delivery-facts-last-confirmed-snapshot\.md|ADR-0015-repository-references-side-by-side\.md|ADR-0016-start-work-owner-generation\.md)$'
git diff --name-only "$BASE"...HEAD | grep -vE "$ALLOW1" | grep -vE "$ALLOW2" | grep -q . && { echo "C7 提交越界"; FAIL=1; }
git status --porcelain | awk '{print $2}' | grep -vE "$ALLOW1" | grep -vE "$ALLOW2" | grep -q . && { echo "C7 工作区越界"; FAIL=1; }
SIZE_OUT=$(node scripts/rule-checks.mjs size "$BASE"); echo "$SIZE_OUT"
echo "$SIZE_OUT" | grep -q '代码：0 / 1000' || { echo "C7 代码预算"; FAIL=1; }
DOC_N=$(echo "$SIZE_OUT" | grep -oE '文档：[0-9]+' | grep -oE '[0-9]+' | head -1); [ "${DOC_N:-99999}" -lt 1300 ] || { echo "C7 文档预算 $DOC_N"; FAIL=1; }
node scripts/rule-checks.mjs disclosure "$BASE" || FAIL=1
if git diff --check "$BASE"...HEAD; then echo DIFF-CHECK-OK; else FAIL=1; fi
awk 'length($0)>3900 {print "LONG-LINE "NR" "length($0)}' docs/adr/README.md
echo "VERIFY-EXIT=$FAIL"; exit "$FAIL"
~~~~
