# PR #696 MMP 交付评审

## Purpose / Big Picture
判断本层能否独立验收、合并和回滚；代码测试不替代用户闭环、已安装 Host 接受或 R1。

## Context and Orientation
2026-11-26 SGT 初始锁定：head `20a8c6674fba691cca064470146afd70fca19c87`，base `feature/multiproject-catalogue-open@5ade68d320275dad3d9268ed627dc395d51602f0`。本层为 #696，所属 issue #692；完整 PR、commits、threads 和 checks 已读取，结论须随版本重新锁定。执行上下文为检出 `feature/multiproject-create-switch` 的 `.worktrees/mp-692-create-switch` 根目录。

## Design / Spec
先建立风险矩阵再逐层审查。核对代码、产品、架构、测试、反例、issue 接受和重复追踪。所有首轮 inline 意见一次性提交；P0/P1 请求修改，只有 P2/P3 则批准并进入根因修复。修复需独立复评。

| 严重度 | 风险与反例 | 层 / 最小判别证据 | 初始结论 |
|---|---|---|---|
| P0 | 凭据泄漏、私有根逃逸、不可恢复数据破坏、合入即破坏 main | 架构 / 安全边界、schema、发布面 | 未发现；无 schema / 凭据面变化 |
| P1 | A 操作写入 B、旧代响应进入新项目、错误 Saved、恢复失败阻止 Host、单一事实源破坏 | 代码 / 产品；并发、失败、重开、真实接线反例 | 本层未发现；沿用 Host 准入装配与 lease，创建候选失败不污染 A |
| P2 | 可恢复的导航、错误反馈、幂等、状态隔离或验收断言不足 | 产品 / 测试；用户路径与相对 base 的判别验证 | 两项：恢复成功后不交接；确认读恢复未结算创建意图 |
| P3 | 文档和证据漂移、过度设计、重复追踪、提交粒度与可读性 | 设计 / 工作项；issue、计划、范围、当前 checks | 未发现独立项；#692 是 #636 实现子项，非重复 issue |

## Global Constraints
遵守七条系统不变量；不写 Planning Status 或依赖关系；评审账号 gh-review（Singularity-AI-Bot），开发/作者回复/合并 gh（SingularityKChen）。仅本 PR 的代码和本评审记录属于本层 ownership。沿用唯一跨层 ExecPlan `docs/exec-plan/active/2026-11-25-multi-project-workspaces.md`；归档在栈顶完成。

## Plan of Work
1. 锁定远端事实、关联 issue 和风险矩阵；完整分层审查并运行最窄判别验证。
2. 一次性提交首轮 review；按根因修复、独立复评，更新本记录。
3. 归档计划、整理交付提交、公开面/体量检查、最终 push 回读，当前门通过后按原生栈 rebase 合并。

验证命令在具体证据处仅记录一次，必须注明检出分支或不可变版本；回滚使用备份 ref 或 revert 本层，不删除 workspace 数据。

## Validation and Acceptance
所有 P0/P1 排除或关闭；每项发现有代码位置、可观察影响与判别证据。全部检查、issue 关联和线程以最终远端 head 回读为准；安装态人类接受与 R1 独立。

## Progress
- [x] 2026-11-26 SGT：锁定初始事实并先建 P0–P3 矩阵。
- [x] 2026-11-26 SGT：完整首轮审查；58 条窄测试、2 条浏览器、4 个变异与 2 条执行恢复探针完成。
- [x] 2026-11-26：Bot 一次性 APPROVE（review 6067377319），两项 P2 inline 已提交。
- [x] 2026-11-26：根因修复与独立复评完成；最终远端 head 门仍须回读。
- [ ] rebase 合并和授权清理。

## Surprises & Discoveries
初始为四层依赖链；不同层共享装配和导航边界，跨层问题归属最早引入该问题的层。

2026-11-26 SGT，以下结论限定于本文件 Context 锁定的 head/base；命令均在该检出的工作树根目录执行。

| 层 | 证据与判断 |
|---|---|
| 代码 / 架构 | id 只由随机创建意图派生；Core create-or-verify 事务拒绝异名冲突；无第二份工作区事实源。切换的装配、lease、pending scope 来自前层，当前新增错误作用域保持 A。 |
| 产品 | 正常 create A/B、Home A↔B、同名独立创建与失败保留 A 可用；创建恢复的两个分支有下列 P2。新建仅本地行，不克隆远端资源。 |
| 测试 | 下表的正常路径绿，但恢复反例 2/2 红；因此既有 40 条 UI 契约不足以证实恢复闭环。 |
| 工作项 / 规模 | #692 acceptance 与 Batch 2 对齐，Refs #636 / Closes #692 存在；四个当前提交无临时 fixup。捕获的 PR Fast Gate/Verify/Browser/Windows Native 成功；Create review session 失败为文档已说明的可选本地端点；取消的 Issue policy 有同 head 成功后继。远端重锁由主评审完成。 |
| 设计充分性 / 复杂度 | 复用 setup source、Host transition 与现有设置表单；无 schema / 新路由 / 多事实目录。确定性 id 消除 Map，规模符合本层边界。只在原 create run 安装 settle 回调的局部实现造成恢复遗漏，应统一意图结算，避免逐按钮补丁。 |

验证记录：

- `node --test --test-timeout=120000 tests/contract/domain-identity.test.js tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-host-switch.test.js`：58/58 pass，无 skip。
- `node --test --test-timeout=120000 tests/browser/project-switch.test.js tests/browser/projects-home.test.js`：2/2 pass。
- 评审反例：在本地运行态 `.superpowers/review-696/repro.test.mjs`，由真实 source + 现有 React hook 夹具复现恢复过程；`node --test .superpowers/review-696/repro.test.mjs`：0 pass / 2 fail，分别为「成功重试后缺少规划连接」和「恢复确认后同名创建仍只有一行」。这些反例未写入产品测试树。
- 执行恢复探针：`node --test .superpowers/review-696/execution-return.test.mjs`：2/2 pass。真实 local Git + SQLite + Host + remote 下，manual running A→create B→return A 的 providerRef、工作树与 issuer 可读；合成当前 ABI 的 Harness running A 在 B 活跃期间完成，回 A 刷新为 succeeded，create/prompt 仍恰好一次。不是安装态录制或人类接受；已提交的空工作区导航断言本身不证明该结论，建议 #694 接纳有判别力的持久回归。
- `node scripts/review-mutate.mjs .superpowers/review-696/mutation-spec.json`：EXIT=0，四个变异均 KILLED；脚本完成字节还原且还原后基线为绿。原始 spec/log 留在本地运行态。

| 变异 | 改动 | killedBy / 结果 |
|---|---|---|
| 696-M1 | 确定性目标退回 randomUUID | same intent key replays to one row / KILLED |
| 696-M2 | 创建候选失败写全局 activationError | a failed create-and-switch scopes activationError / KILLED |
| 696-M3 | 删除正常创建后的意图消费 | a confirmed create consumes its intent / KILLED |
| 696-M4 | 删除正常创建后的设置交接 | creating a project hands off to its connection flow / KILLED |

两项首轮发现（新增行锚点）：

1. **P2 / `packages/ui/src/workspace-setup.ts:91`**：已有 A 从 Home 创建 B，首次 unavailable，错误区「重试」成功后 Host 已切到 B，页面仍为 create 且草稿被 scope 更新清空。根因是成功交接只装在 submit 的 Promise，recovery 的 create/refresh 分支绕开它。最小修复是统一已确认创建的交接路径，并保留失败原地恢复语义。
2. **P2 / `packages/client/src/workspace-setup.ts:192`**：create 已 ack B，但确认读抛错，随后 refresh 成功确认 B，下一次同名创建仍复用原键并静默重放 B。根因是 createdId/settle 只活在原 create run，确认读恢复无法消费已 ack 意图。最小修复是在 intent 保留已 ack 目标，统一在版本栅栏接受且匹配目标的读回上结算；未知 ack 不按名称推断。


## Decision Log
2026-11-26 / 人类直接指定：“你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”覆盖 #695–#698，授权当前评审会话负责修复与条件合并；P0/P1 修复并复评前不得合并。

## Idempotence and Recovery
每次推送前保存本层旧 head 为本地 backup ref，并使用精确远端 lease。失败保持当前分支和已存工作区；不以清理覆盖未提交工作。

## Interfaces and Dependencies
GitHub PR/issue/reviews/checks；已有本层 worktree；依赖链 #695 → #696 → #697 → #698。评审边界不授予规划字段写入权。

## Outcomes & Retrospective
首轮未发现 P0/P1，两项 P2 已复现并交给主评审一次性提交。依据仓库严重度映射首轮事件为 APPROVE；不代表两项问题已修复、安装态接受、R1 或合并。代码未修改，未 commit/push/提交 review。修复、独立复评及远端重锁仍待 owner 执行。

## Bottom Change Note
2026-11-26：在逐文件审查前创建风险矩阵和可恢复的评审流程。

2026-11-26：完成首轮全层审查、四个变异归因与执行任务返回探针，记录两条创建恢复 P2；不把正常路径绿外推到恢复路径。

2026-11-26 修复复评：初始两个P2与原“代码未改”结论 Superseded by 本段。Source 将已ack workspaceId保留在创建意图，共同的被接受读取按精确目标结算，稳定结果标记供UI消费；未知/无关/过期读取保留原键。Gate当前创建意图统一覆盖submit/retry/refresh，确认后写入既有navigation；开始默认创建即固定create，旧标记不劫持新表单。独立复评还抓到后续激活复活create、空profile未知ack时丢默认表单，两项均有red→green且已独立复评通过，无剩余实质发现。

在`3e6ab282e07284da6c678652e91c524e7d2b56f9`加最终UI/测试增量的检出上：相关122/122、浏览器`node --test --test-timeout=120000 tests/browser/project-switch.test.js tests/browser/projects-home.test.js`2/2、原始两反例2/2、typecheck、boundaries10/10与diff检查通过。最终`node scripts/review-mutate.mjs .superpowers/review-696/final-mutations.json`六项均KILLED且还原/基线绿：稳定目标、激活错误作用域、意图消费、确认交接、默认create固定、交接写入既有navigation。整理后的产品blob须与该已验证修复树相同；最终CI/issue/threads仍按远端当前head回读。

最终122项窄组的可复核命令（上述修复检出根目录）：`node --test tests/contract/ui-workspace-setup.test.js tests/contract/client-contract.test.js tests/contract/domain-identity.test.js tests/integration/harness-plugin-host-switch.test.js tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-workspace-status.test.js tests/integration/workspace-setup-commands.test.js`。
