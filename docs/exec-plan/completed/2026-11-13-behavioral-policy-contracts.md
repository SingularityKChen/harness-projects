# 规则测试去除措辞锁 ExecPlan

> 状态：Completed · 实现与独立本地验收通过；远端交付按本计划门禁回读
> 创建：2026-11-13
> 范围：Closes #419；Refs #224；只收口剩余内容归属和 Status 措辞测试。
> 规范：根 `PLANS.md`；开发流程 `docs/development/workflow.md`。

## Purpose / Big Picture

普通文档改写、换行和句子移动不会要求同步改另一份语义正则；入口路径、权威引用和真实 Status／Engineering 写入边界继续受保护。成功证据是两个指定规则文件精简后正常通过，保留引用仍能拒绝坏链接，已有真实 writer／workflow 场景仍能拒绝工程事件跨轴写入。

## Context and Orientation

观察基线为 2026-11-13 15:26 SGT 的 `main@5708e1ed`；执行检出 `test/behavioral-policy-contracts`，工作树 `.worktrees/behavioral-policy-contracts`。#571 已完成 #419 的 Storage 计数／多重集清理，本轮不再恢复。`content-placement.test.js` 保留路由、路径覆盖、任务唯一性、桶和引用存在性；删除把技能落点和详述链接锁在同一列表行的断言。`board-status-semantics.test.js` 现在只核对 README／workflow 对权威定义的引用和目标存在性；旧 LEGACY/NEGATED/HISTORICAL 散文扫描、白名单，以及固定节号、列序和措辞断言均已删除。

事实：`board-workflow.test.js` 已调用唯一 `boardWorkflowFindings` 检查应关闭工作流、机械例外和 unknown/missing；`check-board-workflows-live.test.js` 保护 adapter fail-closed；`engineering-state.test.js` 将字段名伪装为 Status 会拒绝，`engineering-project.test.js` 读回全部 mutation 仅指向 Engineering。假设：这些实际行为证据足够，不新增同义重复矩阵。当前 Project 与正文候选期别差异仅记录，按用户选择交付 PR，不改规划字段。

官方依据：[Google Testing Blog — Test Behavior, Not Implementation](https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html) 建议从可观察行为而非实现细节断言。本任务把可执行的 writer／workflow 边界留给已有行为测试，散文内容由人审阅；不能声称机器能证明全部中文文档的语义等价。

## Design / Spec

采用 A/B 的共同删减方案：保留 content-placement 前五项实际路由／结构完整性，删除同一列表项锁；保留 board-status 文件名并缩成少量真实引用和目标存在性检查。删除全 docs 递归语义扫描、固定措辞／固定节号／列序断言和其历史白名单，不造 Markdown 语义 parser 或第二规则镜像。对权威文件引用优先复用现有文件 token 和路径检查，不扩成通用链接系统。

选择 A 建议的最小真实性文档修正：`docs/development/content-placement.md` §7 当前把旧 board-status 散文扫描描述成活棘轮，需要就地说明现行可执行边界由 writer／workflow 负责、引用由机械检查负责；不改变四桶规范。设计 B 的“权威正文零改动”会留下失实描述，因此不采用。放弃整个测试文件删除，因为会丢真实引用完整性；放弃用新 parser 替换旧正则，因为只是增加另一维护面。

不变量为单 Planning 事实源、工程状态正交、agent 不能自行推进 Status、显式批准和 Host 权威。已有真实 Status 写入防线、board EXPECTED 裁决和真实看板开关都保持；普通文案变化不要求测试同步，而真正 writer 目标或 workflow 错误仍由现有测试变红。

## Global Constraints

唯一允许写入集合如下；`docs/README.md` 最后由协调者串行新增本计划索引行，worker 不写。

| 文件 | 责任 |
|---|---|
| `tests/contract/content-placement.test.js` | 删除句子布局锁，保留真实路由／路径检查 |
| `tests/contract/board-status-semantics.test.js` | 移除散文推断，保留小范围引用与目标检查 |
| `docs/development/content-placement.md` | 仅 §7 旧扫描器现状描述的真实性修正 |
| `docs/exec-plan/completed/2026-11-13-behavioral-policy-contracts.md` | 本活计划，完成后同名归档到 completed |
| `docs/review/pr-630-mmp-review.md` | 本轮独立 MMP 风险矩阵与交付证据 |

规模以最终提交后在本分支运行 V3 的回读结果为准，须低于技术 800、文档 1300 的本批限制；不把实施中间态的计数作为当前值。无生产代码、公共 fixture、装配、依赖、parser、镜像规则、Storage 计数、固定 mutation 配额、数据迁移或旧实验兼容。不改 writer/checker 的实现、权威规则、Status、期别、依赖或真实看板；不碰 PR #555 的安装验收 fixture，不自行合并。

## Plan of Work

### Batch 1 · 精简措辞测试并验证真实边界

最小闭环是文案可自由改写且实际机器守卫仍有效。主文件为两个指定规则测试，配套修正 Global Constraints 所列文档中旧扫描器的现状说明。

### Concrete Steps

协调者已为计划建立 draft PR，并回读 #419、`main` base 和双向 issue 关联。先列出每个被删断言的真实责任：散文语义退回人审，路径／引用留下，Status/workflow 复用现有行为证据；不将每个被删正则重写成新场景。实施轮临时拆分 AGENTS 的规则与链接列表项、将 Status 句改为同义表达：旧布局和固定措辞断言各自 RED，精简后的检查在相同文档变体下 GREEN；坏相对目标探针也 RED 后恢复。本轮修复轮先将 README href 改成 `../product/board-semantics.md-missing`，旧子串检查仍 GREEN，暴露目标后缀缺陷；加入转义路径 token 的完整边界后，同一变异 RED。合法 `#fragment`、软换行及周边同义改写仍通过。各源文档探针均按原文恢复并核对无差异。

在本分支工作树根目录定义唯一验证入口：

    V1: pnpm test:file tests/contract/content-placement.test.js tests/contract/board-status-semantics.test.js tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js tests/contract/engineering-state.test.js tests/contract/engineering-project.test.js
    V2: node scripts/rule-checks.mjs disclosure origin/main
    V3: node scripts/rule-checks.mjs size origin/main
    V4: git diff --check origin/main...HEAD
    V5: gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup

修复轮后 V1 六文件为 97 pass、0 fail；既有字段名 Status 反例、仅 Engineering mutation 目标和跨轴 workflow 拒绝仍真实运行。V2 disclosure 与 V3 size 命令退出码为 0，但其输出明确限定为已提交 `HEAD`，不覆盖未提交源码；最终源码扫描与人工发布面检查仍属独立验收。完整 diff 手工统计为技术 258 行（13 增、245 删）、文档 105 行（104 增、1 删），均低于限制。V4 `git diff --check origin/main` 通过。V5 的 PR base 与双向 issue 关联由协调者在实现前核验；最终 head、checks 与 review threads 尚待最终推送后的独立回读。回滚点是本独立 PR；没有数据／外部设置步骤。

## Validation and Acceptance

Batch 1 的 V1 与临时反证确认：普通文案变换通过、坏引用仍红、实际 Status 伪装拒绝、工程 writer 仅写 Engineering、禁止的内置 workflow 开启会报 finding，机械例外误关与 unknown 仍 fail-closed。V2–V5、独立审读和人工发布面核对后才 Ready。无需全产品 UAT 或以测试条数下降判失败；最终三 PR 组合验证由协调者负责，本交付不裁决 Planning Status 或 R1。

## Progress

- [x] (2026-11-13 15:26 SGT) 读取 issue 剩余范围、两份独立设计及真实 writer／workflow 场景，完成综合。
- [x] (2026-11-13 15:46 SGT) 协调者回读 draft PR 的 #419、main base 和双向 issue 关联。
- [x] (2026-11-13 15:50 SGT) 精简两个规则测试；同一源文档变体下旧断言 RED、新检查 GREEN；坏相对链接 RED 后恢复。
- [x] (2026-11-13 15:50 SGT) 六文件 V1 97 项通过；真实 workflow／writer 反例仍在本轮执行中通过。
- [x] (2026-11-13 16:02 SGT) 修复独立验收 P2：旧子串检查对 `-missing` 后缀 SURVIVED；完整路径 token 边界匹配后被 KILLED。fragment、换行及同义改写探针通过。
- [x] (2026-11-13 16:02 SGT) 修复独立验收 P3：移除 ExecPlan 内本机绝对临时记录路径。
- [x] (2026-11-13 16:04 SGT) 修复后六文件 V1 为 97 pass、0 fail；diff-check 通过，探针源文档均恢复。
- [x] (2026-11-13 16:11 SGT) 独立方案、实施与对抗验收／复评均完成，P0–P3 无剩余发现。
- [x] (2026-11-13 16:11 SGT) 同名归档并更新独立索引；最终提交与 Ready 仍按本计划远端回读门禁执行。

## Surprises & Discoveries

等价否定表达的实际源文档探针触发旧固定短语断言，把规则路径与说明链接拆到相邻列表项也触发旧布局断言；移除文本锁后相同变体通过。初版引用检查对合法目标后缀 `-missing` 误判为存在；完整路径 token 边界可拒绝此前缀假命中，同时允许 fragment 与软换行。Status 真实写入限制已有工程状态字段校验、Project mutation 目标检查和 workflow 的应开／应关／unknown／missing 行为覆盖，不需要散文语义镜像。

## Decision Log

Decision (2026-11-13 / 人类本会话直接指令)：用户点名 PR #628–630，要求无 P0/P1 或只有 P2/P3 时由本评审会话收尾，并“`merge_method=rebase` 合并”。本 PR 首轮无新增 P0–P3，由评审会话补当前记录、整理提交和最终门禁后执行；Planning Status 与原生关系保持由规划所有者决定。评审证据见 `docs/review/pr-630-mmp-review.md`。

- 2026-11-13 15:26 SGT / 独立方案综合者：删除散文语义猜测，保留窄引用；复用已有 writer／workflow 测试，不增加新框架。内容归属 §7 做最小真实性修正，避免保留过时扫描器说明。
- 2026-11-13 15:50 SGT / 实现者：保持本计划 Active，等待独立验收；不归档、不改 `docs/README.md`，由协调者完成最后索引更新。

## Idempotence and Recovery

所有测试使用本地注入场景，不调用真实看板写口，可重复执行。临时探针按原文字节恢复并核对 diff，不保留 fixtures／manifest；失败只撤回本批文件，不覆盖其它工作。交付后整体 revert 本 PR 恢复旧检查，无用户数据回滚。预期完成后无新增技术债；归档前检查 `docs/exec-plan/tech-debt-tracker.md`，若发现实际且明确延后的缺口须先登记并更新计划，既有一般文档链接覆盖缺口不扩成此 PR 新功能。

## Interfaces and Dependencies

需要 Node >=22、pnpm 10.28.2 和冻结 lockfile 对应 workspace 依赖；复用 Node test 和现有字段／workflow checker，无新依赖或凭据。GitHub draft／ready 由协调者记录 actor、目标仓库／ProviderBinding、幂等键及结果。本计划无 Project 字段或关系外部写入授权。

## Outcomes & Retrospective

删除 content-placement 的同列表项布局锁及 board-status 的散文语义扫描，保留真实路由、权威完整路径 token 与目标存在性检查。普通改写及布局变体通过，坏后缀路径被拒绝，临时内容已恢复；真实 Status 伪装拒绝、Engineering-only writer 与 workflow fail-closed 的现有证据继续运行。六文件 V1 97/97 通过；精简未引入通用 parser、第二份语义规则或 Storage 计数台账。

本项无新增或接受延期技术债；保留既有独立 issue 的责任。最终三 PR 组合验证与远端 head/base/checks、双向 issue 关联、元数据及线程回读由协调者执行并在 PR 的当前证据中记录。Ready 以最终 head 的 PR Fast Gate 和独立验收为条件；不代表父项或 R1 人类接受。

组合验证（2026-11-13 16:15 SGT）：在检出 `test/iteration-constraint-integration` 的工作树根目录，基于 `main@5708e1ed` 组合本批三个 PR 的完整差异，无冲突。`pnpm verify` 通过：contract 1578、integration 2252、e2e 226，共 4056 passed，零失败／跳过；类型检查与包边界 9/9 通过。此后仅补充本结果说明，产品／测试源码保持该组合。

### Artifacts and Notes

规格、反例、恢复和验证入口均在本计划；运行日志为本地临时内容，不成为仓库外前置。

## Bottom Change Note

Change Note (2026-11-13 16:04 SGT)：按独立验收修复引用目标后缀漏检，并从计划移除本机绝对日志路径。完整 token 边界不锁定散文；V1 通过，独立复评仍 pending。 Superseded by Progress（2026-11-13）：该时点待复评状态已由最终独立验收通过取代。

Change Note (2026-11-13 16:11 SGT)：独立复评通过后收敛实际结果、清除待验状态并归档，保持最终远端交付门禁为可回读规则。

Change Note (2026-11-13 16:15 SGT)：补充三个独立 PR 的完整组合与 4056 项全量证据，确认最终产品源码与已验证组合一致。

Change Note (2026-11-13)：独立 MMP 复核无新增缺陷，补本 PR 评审记录和用户条件 rebase 授权；保持已完成归档，最终 head/checks 按回读门禁判断。

Change Note (2026-11-13)：修复 MMP P3-1，Global Constraints 的规模改为最终命令回读规则；V1 段落中的修复轮计数保留为当轮历史证据。
