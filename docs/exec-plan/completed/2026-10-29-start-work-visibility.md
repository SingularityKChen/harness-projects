# Start Work 不可见目标准入 ExecPlan

> 状态：Completed；创建：2026-10-29（Asia/Singapore）；关联：Closes #349，Refs #303。
> 规范：`PLANS.md`；一个 PR 完成错误保密与事务准入，不改变规划状态或公共接口。

## Purpose / Big Picture

对当前凭据不可见的工作项，无论不存在还是内容被扣下，Start Work 都返回同一固定、不可重试的结果；操作者应去原平台解决可见性，而非原样重发。同步在预检后撤回可见性时，准入事务不得登记该工作项或留下 pending attempt。

最小证据是 Fake 和真实 SQLite 上同一命令入口的错误逐字等价、零登记/工作树/业务修订增量，以及确定性同步交错的拒绝结果；可见正控必须正常开始。

## Context and Orientation

在检出 `fix/start-work-visibility` 的工作树根运行（仓库相对位置 `.worktrees/start-work-visibility`）。2026-10-29 观察基线为 `06d929017c8551e6b106fcbe7651f12ac26e4642`；实施前用 `git rev-parse HEAD` 和 `gh issue view 349 -R SingularityKChen/harness-projects --json state,body` 重核。

`packages/core/src/start-work.ts` 的 `prepareRegistration` 目前只对新 context 在根 Storage 预读；missing 含目标 ID，redacted 给 unavailable。仓库 ack 后 `claimContext` 才开始事务并写 attempt 和登记父实体，没有复判。same-key replay 在该预检之前返回，既有 context 也跳过预检。`packages/core/src/status-policy.ts` 的状态命令已用事务内投影判断返回统一 not_found；`packages/capabilities/src/result.ts` 定义该错误的 open_provider / retryable:false。

`tests/integration/start-work-sqlite-registration.test.js` 已有双适配器入口与 world 快照，但需增加修订号与判别性 interleaving。`docs/product/vertical-path.md` 第 6 行记录失败形态。SQLite transaction 使用 BEGIN IMMEDIATE，Fake transaction 串行化；同步和准入必须共享这一本地事务边界。

## Design / Spec

选择“早期只读守卫 + 准入事务复判”。请求 primitive/名称形状校验保持优先；随后在 lookup replay、context 和 Development 路由之前检查 workspace 范围投影。missing、其他工作区条目和任意 redaction reason 均返回固定文案“规划条目不存在或对当前凭据不可见，无法开始工作”，完整字段为 `not_found / open_provider / retryable:false`。不包含目标 ID、标题、reason、仓库信息。可见 ChangeRequest 保持 invalid_input，可见 unknown planningStatus 不自动拒绝。

既有 context、终态接管、在途观察和同 key replay 都执行该早期守卫：当前不可见时不返回工程谱系、不读回或改写既有 run/attempt。这是对 #349 “before any write and before routing”的显式解释，不保留历史 replay 绕过。已存在记录和已发生外部资源不删除、不撤销。

`claimContext` 的事务最前用 `tx.getPlanningProjection` 重新判断，先于 attempt/key 绑定、select/route、ledger、父实体和 context 写；拒绝使用现有 rejected union。早期可见结果不能捕获为事务权威；事务内读取和登记只用 tx，不调用根 Storage 或持锁等待 Provider。同步先提交撤权/删除时拒绝，准入先提交时合法事实保留；本任务不实现已经准入后的连续授权撤销。

同步竞态至少让 getRepository 在预检后停住，经正常 Storage transaction 提交 redacted 或移除投影，再释放 ack，确认无分支/工作树/run、无新实体/身份/挂载/context/attempt/关系/修订。路由或仓库只读 ack 已经发生的场景不谎称“零 Provider 调用”；初始不可见场景必须零路由及零仓库读。

不选“整个准备过程放入事务”：Provider await 会占用唯一写锁并可能与根 Storage 自等。不新增 Storage CAS 或通用授权框架。#420 单独负责 existingResult 的陈旧 Ready→Failed 与供应 owner 结算竞争；本任务不能宣称解决这些所有权问题。

## Global Constraints

写集仅为 `packages/core/src/start-work.ts`、`packages/core/src/queries.ts`、`packages/core/src/context.ts` 的 unavailableCore 查询对齐、`packages/controller/src/commands.ts`、`tests/integration/start-work-sqlite-registration.test.js`、`tests/integration/start-work-request-binding.test.js` 的可见异目标夹具、`docs/product/vertical-path.md` 的 Start Work 局部订正、本控制计划及 `docs/README.md` 的生命周期索引。复用现有测试夹具；不另造整套 fixture，不新增模块、schema、依赖、enum 或 Provider；仅新增 Core 内部类型化只读预检查询，client/Host remote 公共 ABI 不变。

预计代码/测试 200–400 行，单 PR 必须小于 800；文档小于 1300 行。正文中文、仓库相对路径，不公布凭据、本机身份或内部系统。不改 Status、Iteration、原生依赖或人类验收；用户已授权提前推进本项，规划时间框仍保留。

同一 Start Work owner 先做本项再做 #420，各自在独立工作树；默认各自对 main，是否堆叠由真实组合差异和验证决定，不凭同文件推导依赖。#423 与指南可按分离写集并行。全局文档索引由主控协调，避免并发覆盖。

本次授权评审收尾扩展文档写集：`docs/review/pr-454-mmp-review.md`、`docs/review/2026-10-29-pr445-pr456-mmp-review.md`、`docs/review/README.md`、`docs/project-management/merge-queue.md`；只记录本轮交付与合并顺序，不扩展产品范围。

## Plan of Work

### Task 1 · Batch 1：统一不可见错误并关闭准入窗口

**最小闭环**：不可见请求在路由前诚实拒绝，撤权与登记在同一事务裁决。**涉及主文件**：`packages/core/src/start-work.ts`。

先提交计划建立 draft PR，关联 #349；再写双适配器 RED：missing/redacted 全字段等价、零世界及修订增量、无路由；同 key 和既有 context 变为不可见后拒绝且旧事实不变；visible/ChangeRequest 正控；getRepository barrier 与已提交撤权/删除交错。先执行窄测试，必须因上述行为断言失败而红，导入/安装错误不算 RED。实现共享判定与事务复判，更新局部文档，然后重复相同命令转绿。

所有命令在上述任务分支工作树根，记录 head、实际输出及跳过原因：

```sh
pnpm test:file tests/integration/start-work-sqlite-registration.test.js tests/e2e/status-policy.test.js tests/integration/start-work-request-binding.test.js
pnpm run typecheck
pnpm verify
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望新测试在 Fake/SQLite 非零执行、全部通过，typecheck/verify 退出 0，disclosure 无发现、size 代码小于 800/文档小于 1300、diff 无空白错误。先窄后宽；身份/事务边界允许一次完整 verify，后续仅新变更或失败触发重跑。人工检查公开面五类目，不以机械扫描替代。

本项可独立验收/回滚，不以尚未交付的 #420 设置新的前置；组合预演由 #420 的交付门承担，并引用本项冻结候选。同 owner 在临时组合检出应用本项与 #420 最终候选，运行 registration、request-binding、owner-fencing、recovery 相关测试；临时检出由主控按 realpath/允许根核对，不能改动用户其他工作树。组合结果决定 main-base 或最小栈；按各自真实 base 重算规模和差异。整理计划提交与实现提交，最终 push 后回读 PR head/base、issue 关联、checks 和全部 review threads（`gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,isDraft`；`gh pr checks -R SingularityKChen/harness-projects`），当前证据满足才 ready，不自行合并。完成后更新本计划、移 completed 并修索引。**回滚**：revert 本文档/代码提交，恢复旧行为；无数据迁移，不删既有执行资源。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 错误不泄漏存在性 | missing/别工作区/all-redaction 的固定消息、code、recovery、retryable 逐字相同；先于路由 |
| 不可见时零新事实 | Fake/SQLite 的实体、身份、挂载、context、run、attempt、关系、revision 和外部计数对照不变 |
| 原子准入 | barrier 命中，正常事务先提交撤权或移除，释放后拒绝；反向提交顺序保留合法 claim |
| 既有与重放边界 | invisible same-key/既有 context 早期拒绝且旧事实不变；可见成功/ChangeRequest 无退化 |
| 可交付证据 | RED→GREEN、类型/完整验证、公开面、实际 own-base 规模、远端最终 head 与独立审读 |

## Progress

- [x] (2026-10-29 +08) 本地闭环及独立最终验收完成；最终远端发布门按本计划回读命令执行，不把本地结果冒充 hosted CI。

- [x] (2026-10-29 +08) 读取两份独立设计、live #349、owning source 与现有测试；明确既有/replay 策略并完成综合计划。
- [x] (2026-10-29 +08) 计划提交 `9971c903794e` / draft PR #454 已由主控建立；有效 RED 150 项 / 18 条行为失败；完成最小实现与局部文档，聚焦 GREEN 154/154，typecheck 通过。
- [x] (2026-10-29 +08) `pnpm verify` 通过（完整 test 2483/2483；MVP-0 7/7）；本批不重复机械扩大验证。
- [x] (2026-10-29 +08) 独立评审 P1 的 Controller cache 绕过经 RED 4/4 复现，Core-owned 只读查询与 Controller 先验接线修复，聚焦 184/184；新完整回归见 Outcomes。
- [x] (2026-10-29 +08) 评审轮 2 的 mutable request 窗口经双存储 RED 复现；同步深捕获修复后四文件聚焦 192/192，类型通过，新完整 verify 见 Outcomes。
与 #420 的组合预演由 #420 的交付门记录，不是本项独立完成的前置；不新增规划依赖。
- [x] (2026-10-29 +08) 独立完整验收、发布面与生命周期索引完成；候选 `d48ab5a0412b` 的当前 head/base、双向 #349 关联、全部线程和 hosted CI 已回读，PR Fast Gate、Merge Gate、CodeQL、规则/issue 检查通过。发布本记录后继续对新 head 重读才 ready；无新 Demo/UAT 裁决。

## Surprises & Discoveries

最终审读 P3 的旧测试标题引用已更新为当前「不可见目标在重放与路由前统一拒绝…」；这是可定位性订正，未改测试或产品代码。

轮 2 的首次完整 verify 未通过：2501 tests / 2500 pass / 0 fail / 1 cancelled，`development-subset-matrix-rejects-liars` 在 120000 ms 达上限。该未修改测试串行启动多份 child Node adapter；未发现行为断言失败。单独同名用例在原上限下 1/1 通过（约 29.4 秒），未改 timeout 或测试政策；资源争用只是待证假设，不当作根因裁决。其后在主控确认其它验证任务结束后重新执行完整 verify，结果另记。

独立替代审读在 `11944da4f9f4` 进一步确认 mutable input 的异步窗口：query 检查 A 后，调用方立即把原对象改为隐藏 B，Controller 重新读取 input 后可命中 B 的旧成功缓存。纯 TypeScript readonly 不提供运行时独立性；原输入必须在第一次 await 前捕获。有效 RED 8 tests / 2 pass / 6 fail，失败均为旧句柄或合法原请求被 retarget；不存在导入/安装失败。修复使用同一个 canonical 普通值遍历产出身份与副本，不另写 JSON/序列化政策；自有副本深冻结，调用方对象不动。

独立审读在 `a1fdf5a02dfc` 确认 typed Controller 的成功缓存反例：Fake/SQLite 撤权或删除后，同 key 不再进入 Core。当前 Host 的 `host-composition.ts` 已有前后守卫，因此不将此反例称为已证实的 Harness UI 泄漏。新增真实 Controller RED 4 tests / 0 pass / 4 fail，均为旧成功缓存缺少固定拒绝错误；修复后四文件聚焦 184/184（包括 in-flight 合并、完整 canonical 指纹和无 identity 的可见正控）。

首轮夹具错误（误用 Planning 的 gate 属性、把替身种子外部总数当增量）已在实现前修正；有效 RED 为 150 项中 18 条行为断言失败，无导入错误。最小实现后新用例通过，但请求身份回归 7 条把不可见 `missing` 目标预期为 conflict；按已批准的可见性优先规格调整为可见异目标夹具，保留身份冲突语义。

旧预检只保护首次登记，replay 提前返回；因此只替换 redacted enum 不能满足保密边界。原 world 快照不包含 revision，需要补读以证明 AC。主控报告安装产生的 pnpm-workspace 占位变更已按精确内容恢复；此任务不以依赖安装扩大写集。

## Decision Log

- Decision：Controller 在第一次 await 前同步捕获完整普通值请求及嵌套 actor 元数据；同一自有副本用于目标查询、key/指纹、in-flight 与 Core handoff，不 freeze 或修改调用方。Rationale：独立评审在 `11944da4f9f4` 证明只捕获预检目标而稍后重读 input 可把可见 A 切换成隐藏 B 的缓存；沿既有 canonical 的 undefined/null、数字、数组顺序、普通/null 原型和循环约束做一次遍历，避免 JSON 或 Core primitive 投影丢失身份信息。Date/Author：2026-10-29 +08 / 主控授权评审修复轮 2。

- Decision：新增目标专用只读 Core query，复用 startTargetError；不选择 getItemDetail 或在 replay 前重跑整个命令。Rationale：getItemDetail 还要求 primary identity，可见但未登记 identity 的 projection 会被误判；重跑命令可能在 Controller canonical 冲突判定前供应外部资源。完整输入 preflight 还会改变可见同 key 的 null/undefined 等现有 canonical 冲突语义，因此只验证目标 primitive/可见性，完整请求仍按已有 Controller/Core 各自边界处理。Date/Author：2026-10-29 +08 / 实现者，主控授权最小 Core-owned query 扩展。

- Decision：独立评审确认 typed Controller 的 settled replay cache 可绕过本次 Core 守卫，扩展 commands.ts 与既有 registration 集成夹具，先经真实 Controller 复现再修复；保持 Core 为可见性及完整请求持久权威，不新增 Controller 错误政策。Rationale：保存的 Design 覆盖同 key 新调用；当前 Host 已有前后守卫，发现不等于 Harness UI 已泄漏。Date/Author：2026-10-29 +08 / 主控授权评审修复。

- Decision：请求身份回归用例把异目标从不存在的 `missing` 改为已有可见的另一工作项，保留 conflict 的完整请求断言；不可见目标由本项固定 not_found 用例覆盖。Rationale：早期可见性优先的已批准规格使 7 条旧断言不再可达，不能回退实现以迁就旧夹具。Date/Author：2026-10-29 +08 / 主控授权最小测试写集扩展。

- Decision：用户选定 #349/#420/#423 提前实施，保留 Iteration/Status/原生边。Rationale：执行授权与规划字段独立。Date/Author：2026-10-29 +08 / 用户授权由主控转达，综合评审者记录。
- Decision：采用 A 的双读事务准入，采用 B 对 replay/既有目标的统一早期守卫；不扩大为供应中途持续撤权。Rationale：live issue 要求路由前统一错误，登记要在同一 tx 判；现有事实不追溯删除。Date/Author：2026-10-29 +08 / 独立综合评审者。
- Decision：两个原设计不互改，独立综合按 owning source 修订；外部研究采用 SQLite 官方 `https://www.sqlite.org/lang_transaction.html` 的 IMMEDIATE 写事务约束与 MITRE CWE-367 `https://cwe.mitre.org/data/definitions/367.html` 的 check/use 风险分类，不引入外部锁。Date/Author：2026-10-29 +08 / 独立综合评审者。

- Decision：外部写入 actor 为 SingularityKChen，目标为本仓 issue #349、GitHub Project #10 和 PR #454；关联键 `iteration-delivery-20261029:tracking-v1`。draft、Closes/反向关闭引用、milestone、标签、assignee 及 ExecPlan/Batch 已 ack/回读；原 Status、Iteration、blocked-by/blocking 未写。Rationale：工程跟踪与规划验收分离。Date/Author：2026-10-29 +08 / 主控记录。

- Decision：2026-10-29 用户在本会话直接授权评审 PR #445、#454–#456，且无 P0/P1 时“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。本 PR #454 首轮完整评审无新增缺陷，故主控接手该分支的提交整理、最终复评和有界 issue 收尾；不重复请求 owner/merge 批准。Rationale：这是覆盖本 PR 的本次人类直接授权，优先于评审手册的默认逐次询问；有未修复 P0/P1 则不合并。原计划已经 Completed，本轮保留归档并将证据放入 `docs/review/pr-454-mmp-review.md`。Date/Author：2026-10-29 / 主控记录。

## Idempotence and Recovery

测试夹具为隔离可重复环境。visibility 拒绝不占新 key，不改旧事实；重新获得可见性后由操作者重新决定操作。失败保留真实输出，不以跳过替代通过。若与 #420 组合失败，先定位守卫/claim 交叉点，修复并重复最窄组合；不改父项门禁或规划字段绕过问题。

## Interfaces and Dependencies

使用现有 Storage transaction、workspace-scoped projection、ProjectError 和 structured Claim；新增 CoreQueries.getStartWorkTargetError(workItemId) 复用同一个 Core 守卫，先校验目标 primitive/名称形状再读取 projection，不调 Provider、不写或推进修订。Controller 首次 await 前同步复制完整请求的普通值结构，再用同一自有副本在 replay 指纹/缓存/在途分支前调用；错误直接转 CommandResult，不保存第二份可见性政策。其余完整请求 canonical 校验与 in-flight 合并保持原路径；Core startWork 仍先校验完整请求再准入。unavailableCore 查询返回既有 not_supported；无新增依赖。Git/gh 读取应绑定分支/head及 `-R SingularityKChen/harness-projects`。现有技术债按 `docs/exec-plan/tech-debt-tracker.md`；此切片不接受新债，陈旧 owner 和外部唯一性仍由 #420/#421 承担，不以本项关闭父级正确性门禁。

## Outcomes & Retrospective

最终本地验收：2501/2501 + MVP-0 7/7；聚焦 192/192；类型检查通过。首轮完整验证有一项 120 秒矩阵取消，单跑及完整重跑通过，未提高门槛；资源竞争仅是假设。 两轮独立复评关闭 Controller 缓存与异步可变输入的两个 P1，最终完整审读通过；快照补丁与最终提交逐字匹配。 原始实现/复评观察绑定的候选为 `7a6c5feea619`；之后只整理本计划生命周期、导航和文字引用，产品代码及测试未变。没有新增技术债；既有恢复/外部执行问题保持原 issue 和 tracker 边界。最终远端 head/base/checks/双向关联/全部线程以 `gh pr view 454 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,isDraft` 及检查面板回读为准，满足门禁才 ready。


本地实现已完成，等待独立审读；计划仍为 Active，不用本地结果代替远端检查或人类 Demo/UAT。 **Superseded by 本节最终本地验收与 Progress 的候选交付回读（2026-10-29）**；以下保留首次候选的历史测试记录。

- 基线：`main@06d929017c85`；已发布的计划提交保留为 `9971c903794e`，本地实现提交由主控回读当前 head。
- RED：上述三文件聚焦命令实际 150 tests / 132 pass / 18 fail，全部为初始不可见读取越界、事务撤权后仍供应或既有/replay 返回旧结果的行为断言，0 cancelled/skipped/todo。实现前修复夹具错误不计入有效 RED。
- GREEN：同一聚焦命令在增加 closed 终态对照后 154 tests / 154 pass / 0 fail / 0 skipped / 0 todo。`pnpm run typecheck` exit 0；`pnpm verify` exit 0，完整 test 2483 tests / 2483 pass，MVP-0 7 tests / 7 pass，均 0 fail/skipped/todo。
- 早期判定位于 primitive 校验之后、context/key/routing 之前；claim 事务第一条业务读复判当前 projection，只有可见条目可进入 route/ledger/register。固定错误不泄漏目标 ID、reason 或已有工程句柄。
- Fake/SQLite 均覆盖撤权和移除先提交的拒绝，以及合法准入先提交的供应保留；Ready/Failed/Closed/Provisioning context 在撤回后同 key 与新 key 均拒绝且保留旧事实。world 比较加入身份、Provider 挂载与业务 revision。
- 不新增数据迁移、依赖、client/Host remote ABI 或技术债；持续授权撤销、陈旧 owner fencing 与外部唯一性分别保持 #420/#421 的边界。组合预演、独立审读与 hosted CI 尚未执行/回读，不宣称已通过。

### 独立评审修复轮 1

旧候选 `a1fdf5a02dfc` 的 Controller cache P1 已实施修复，等待新 head 的独立复核。Core 新增 `queries.getStartWorkTargetError(workItemId)`：目标 primitive/名称校验后读取 workspace-scoped projection，返回既有结构化错误或 undefined；无 Provider 调用、无写入、无修订推进。Controller 每次先调用它，再走原有 canonical cache/in-flight；不可见时不返回旧 value、不占 key。Core 本体仍先校验完整 StartWorkRequest，再执行同一守卫与事务准入。没有把可见性规则或错误文案复制到 Controller。

有效 Controller RED 为 4/4 行为失败；修复后 `pnpm test:file tests/integration/start-work-sqlite-registration.test.js tests/integration/start-work-request-binding.test.js tests/e2e/status-policy.test.js tests/e2e/controller-roundtrip.test.js` 184 tests / 184 pass / 0 fail/skipped/todo，`pnpm run typecheck` exit 0。本轮 `pnpm verify` exit 0：完整 test 2493 tests / 2493 pass，MVP-0 7 tests / 7 pass，两层均 0 fail/skipped/todo；此为 Controller 改动后的新验证，独立复核与 hosted CI 仍待。

### 独立评审修复轮 2

Core 查询接口保持不变。Controller 同步沿既有 canonical 接受域捕获完整请求及 actor 的嵌套普通值，使用同一自有副本做 preflight、key/canonical/in-flight 和 Core handoff；不修改或 freeze 调用方，也不把 Core 的 primitive-only 请求投影当 Controller 身份。unsupported 值、非普通原型与循环以原有结构化 invalid_input 方式拒绝。原 settled cache 隐藏目标拒绝、可见 exact replay 与在途合并保持通过。

新增确定性测试用生产 query 的真实 yield（不 mock/delay）：Fake/SQLite × redact/remove 的 A→隐藏 B 缓存切换必须 conflict；合法 A 在全请求/actor 元数据立即修改后按原 key/分支/身份供应。双存储同时验证嵌套数组顺序、undefined/null、缺键及普通/null 原型的既有 canonical 语义，invalid shape 零副作用和不冻结调用方。RED 8 tests / 2 pass / 6 fail；最终四文件聚焦 192 tests / 192 pass / 0 fail/skipped/todo，typecheck exit 0。最终完整重跑 `pnpm verify` exit 0：2501 tests / 2501 pass / 0 fail/cancelled/skipped/todo；MVP-0 7/7。同一源码的首次完整超时及单独复现仍保留在 Surprises；独立复核及 hosted CI 尚待。 **Superseded by 本节最终验收与 Progress 的候选交付回读（2026-10-29）**。

## Bottom Change Note

- 2026-10-29 +08：在候选的远端代码门通过后记录独立验收/交付回读，清除过时未完成状态并原处标注历史结论；本次仅文档审计，不改产品或测试，新的当前 head 仍需回读。

- 2026-10-29 +08：独立最终验收通过，归档计划、整理导航和外部交付回读规则；仅更新本地完成证据，不代替人类验收或 R1。

- 2026-10-29 +08：综合两份独立设计与 live issue；明确固定错误、replay/既有目标覆盖和事务准入线性化边界。

- 2026-10-29 +08：按 TDD 完成初始/事务可见性守卫、双存储提交顺序和既有重放回归；记录旧夹具优先级冲突与写集扩展，本地验证通过，独立验收和远端回读仍待。

- 2026-10-29 +08：独立评审后扩展最小 Core query/Controller 写集，记录展示查询歧义与命令重跑风险，补真实 Controller 缓存及在途反例和查询零写/零 Provider 对照。

- 2026-10-29 +08：评审轮 2 修复 Controller 第一次 await 前的请求捕获，复用 canonical 接受域并补生产 query yield 的深层输入变化反例；保留旧问题的明确层边界。

- 2026-10-29：追加本次人类授权、独立全矩阵评审与收尾证据引用；源代码变异已还原，无未修复新缺陷。
