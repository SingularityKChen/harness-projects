# 规则测试去除措辞锁 ExecPlan

> 状态：Active · 方案已独立综合，实现未开始
> 创建：2026-11-13
> 范围：Closes #419；Refs #224；只收口剩余内容归属和 Status 措辞测试。
> 规范：根 `PLANS.md`；开发流程 `docs/development/workflow.md`。

## Purpose / Big Picture

普通文档改写、换行和句子移动不会要求同步改另一份语义正则；入口路径、权威引用和真实 Status／Engineering 写入边界继续受保护。成功证据是两个指定规则文件精简后正常通过，保留引用仍能拒绝坏链接，已有真实 writer／workflow 场景仍能拒绝工程事件跨轴写入。

## Context and Orientation

观察基线为 2026-11-13 15:26 SGT 的 `main@5708e1ed`；执行检出 `test/behavioral-policy-contracts`，工作树 `.worktrees/behavioral-policy-contracts`。#571 已完成 #419 的 Storage 计数／多重集清理，本轮不再恢复。`content-placement.test.js` 前五项检查路由和归属表的任务、路径、桶、重复与存在性；最后一项要求规则和链接恰在同一列表行，属于布局耦合。`board-status-semantics.test.js` 的 LEGACY/NEGATED/HISTORICAL 及白名单扫描在猜中文散文，余下测试还锁定固定节号、列位置和措辞。

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
| `docs/exec-plan/active/2026-11-13-behavioral-policy-contracts.md` | 本活计划，完成后同名归档到 completed |

技术增删预计 290–390（主要删除），文档 90–150 行；严格技术小于 800、文档小于 1300，删除全部计入。无生产代码、公共 fixture、装配、依赖、parser、镜像规则、Storage 计数、固定 mutation 配额、数据迁移或旧实验兼容。不改 writer/checker 的实现、权威规则、Status、期别、依赖或真实看板；不碰 PR #555 的安装验收 fixture，不自行合并。

## Plan of Work

### Batch 1 · 精简措辞测试并验证真实边界

最小闭环是文案可自由改写且实际机器守卫仍有效。主文件为两个指定规则测试，配套修正 Global Constraints 所列文档中旧扫描器的现状说明。

### Concrete Steps

协调者先为计划建立 draft PR，声明 `Closes #419`、`Refs #224`，回读 issue/main base/draft 后再实施。先列出每个被删断言的真实责任：散文语义退回人审，路径／引用留下，Status/workflow 复用现有行为证据；不将每个被删正则重写成新场景。删除后进行一次有界普通措辞／换行探针：可临时让测试现有 read 入口返回语义保持改写后的同一文档内容，无落地 fixture或新 parser；确认旧锁触发、精简后通过，随后撤销探针。保留引用做一次坏目标探针，确认对应断言红并恢复。只读复跑真实 writer／workflow 场景，不另造重复矩阵。

在本分支工作树根目录定义唯一验证入口：

    V1: pnpm test:file tests/contract/content-placement.test.js tests/contract/board-status-semantics.test.js tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js tests/contract/engineering-state.test.js tests/contract/engineering-project.test.js
    V2: node scripts/rule-checks.mjs disclosure origin/main
    V3: node scripts/rule-checks.mjs size origin/main
    V4: git diff --check origin/main...HEAD
    V5: gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup

V1 期望全部 pass；既有字段名 Status 反例、仅 Engineering mutation 目标和跨轴 workflow 拒绝仍真实运行。V2–V4 无违规且人工复算满足更严限制；未提交差异另做五类发布面人工检查。V5 由当前分支解析 PR，期望 main base、本叶子关联和最终 head 的 Fast Gate 通过；协调者另回读 review threads。回滚点是本独立 PR；没有数据／外部设置步骤。

## Validation and Acceptance

Batch 1 的 V1 与临时反证确认：普通文案变换通过、坏引用仍红、实际 Status 伪装拒绝、工程 writer 仅写 Engineering、禁止的内置 workflow 开启会报 finding，机械例外误关与 unknown 仍 fail-closed。V2–V5、独立审读和人工发布面核对后才 Ready。无需全产品 UAT 或以测试条数下降判失败；最终三 PR 组合验证由协调者负责，本交付不裁决 Planning Status 或 R1。

## Progress

- [x] (2026-11-13 15:26 SGT) 读取 issue 剩余范围、两份独立设计及真实 writer／workflow 场景，完成综合。
- [ ] (2026-11-13 15:26 SGT) draft 关联回读；完成 Batch 1、文案／坏引用探针和独立复评。
- [ ] (2026-11-13 15:26 SGT) 当前 head 验证后填写结果、归档并由协调者更新索引。

## Surprises & Discoveries

“保留 Status 安全”已有真实字段解析和 writer mutation 证据，不必用散文正则替代。删除扫描代码同时会让 content-placement §7 的现状说明失真，因此需要最小文档修正。规则路由表的实际结构是其被测对象，保留这类机械完整性与删除普通措辞锁并不矛盾。

## Decision Log

Decision：直接删除语义猜测，保留窄引用，复用现有 writer／workflow 测试，不添加新框架。Rationale：消除同一规则第二副本，维护真实权限边界；A 的文档真实性修正优于 B 的完全不改正文。Date/Author：2026-11-13 15:26 SGT / 独立方案综合者。

## Idempotence and Recovery

所有测试使用本地注入场景，不调用真实看板写口，可重复执行。临时探针按原文字节恢复并核对 diff，不保留 fixtures／manifest；失败只撤回本批文件，不覆盖其它工作。交付后整体 revert 本 PR 恢复旧检查，无用户数据回滚。预期完成后无新增技术债；归档前检查 `docs/exec-plan/tech-debt-tracker.md`，若发现实际且明确延后的缺口须先登记并更新计划，既有一般文档链接覆盖缺口不扩成此 PR 新功能。

## Interfaces and Dependencies

需要 Node >=22、pnpm 10.28.2 和冻结 lockfile 对应 workspace 依赖；复用 Node test 和现有字段／workflow checker，无新依赖或凭据。GitHub draft／ready 由协调者记录 actor、目标仓库／ProviderBinding、幂等键及结果。本计划无 Project 字段或关系外部写入授权。

## Outcomes & Retrospective

当前仅交付计划，产品及测试文件尚未改动。实施后在此填写实际删减、行为结果和偏差，不把旧绿色基线当新 head 验收。

### Artifacts and Notes

保留必要的文案 green／坏引用 red→restore→green 摘要和真实行为验证结果，不记录冗余用例配额。全部执行上下文已在本计划，仓库外报告不作为前置。

## Bottom Change Note

Change Note (2026-11-13 15:26 SGT)：综合独立 A/B 方案，锁定两个规则测试与一处真实性文档修正，保留已有 Status／workflow 的真实行为证据，去除散文扫描和布局锁。
