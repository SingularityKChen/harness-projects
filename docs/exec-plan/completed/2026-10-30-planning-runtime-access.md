# Planning 运行时访问撤销与恢复 ExecPlan

> 状态：Active（本地实现与 A 行为验证完成；独立复核及最终远端门尚未完成）；创建：2026-10-30（Asia/Singapore）。
> 范围：同一 Host 内 Planning 拒读、离线保留、迟到结果、直接命令拒绝及显式恢复。
> 关联：Refs #457；Closes #465。
> 本文按仓库根 `PLANS.md` 维护；设计、实施和验证共用这一份活文档。

## Purpose / Big Picture

用户正在浏览工作区时，Planning 凭据失去读取权限，列表与已打开详情应立即停止显示受保护内容。直接调用 Start Work 同样被拒绝，不创建分支、工作树、执行记录或控制账本。临时离线保留原许可内容并标为 stale；恢复权限后，用户在同一 Host 和客户端中重新验证，取得完整新确认后恢复内容。

最小证据是 Provider 注入拒读后，SQLite 投影已经 redacted、业务 revision 前进、生产 Host watch 到真实 client store 的内容一致遮罩，直接命令无副作用；旧成功和旧失败均不能推翻新权限状态。这个 PR 独立关闭 Planning 子问题，#457 的 Delivery、逐步写门和真实浏览器总验收继续开放。

## Context and Orientation

Planning 是工作区唯一规划事实源；Core 拥有现行访问判断，Controller 转 wire，Host 承载生产命令与 watch，client 仅接受这些事实。redacted 是已有内容状态，表示内容因权限不可见；stale 表示最后确认值仍获准显示但已经陈旧。二者不可互相代替。

2026-10-30 在工作树 `fix/planning-runtime-access` 的 `7907efbbdc5e35cc8ea4769c7067e885cec844e1` 上调查：`packages/core/src/bootstrap.ts` 的失败路径仅写 degraded cursor；`packages/core/src/queries.ts` 仍读旧投影；`packages/core/src/start-work.ts::startTargetError` 只检查该投影是否 redacted。独立设计调查在此基线复现：refresh 返回 permission_denied，旧内容仍可见且直接 Start Work 返回 saved。该复现是本地替身证据，不是上游实际授权试验。

`packages/core/src/context.ts` 组合时只收集一次 registry；`packages/core/src/registry.ts` 已有 capability、permission、policy 求交。`packages/controller/src/wire.ts::toWireEntity` 已对 redacted 去除外部定位和规划字段，可复用。`apps/harness-plugin/src/host-composition.ts` 已有读取前后可见性守卫；`host-planning-lifetime.ts` 和 60 秒 scheduler 已处理超时与调度，无需另建服务。

恢复存在自锁：`packages/client/src/planning-refresh.ts` 与 `packages/ui/src/work-item-app.ts` 都要求 Planning readable 才允许 refresh。运行时 denial 接入后必须同时修复这两处。来源名 `context.projectTitle` 当前在读取中提前赋值，也必须服从完整提交及遮罩边界。

主 `main` 会继续变化；执行者在该工作树根运行 `git status --short --branch`、`git rev-parse HEAD origin/main`，确认实际基线并记录。已知 UI frame 已进入后续 main；开始产品修改前由协调者将本计划所在分支更新到实际 base，复查上述函数与 UI 恢复接线。本计划不要求尚未合并的 UI detail/forms PR。

## Design / Spec

### 单一运行时访问拥有者

在 Core 增一个有界 runtime-access 实现，保存当前挂载的有效访问、实际 operation 的拒绝观察和单调 access epoch。epoch 是同一 binding/key 的访问版本号，Provider I/O 开始时捕获，提交与返回前复验。所有门继续读取同一 current registry；不能另建 UI permission map、第二 Planning 源、第二权限数据库或通用授权代理。

绑定身份、声明 key 闭集、原 policy 求交复用 registry 校验。显式 refresh 可以针对已有 Planning 挂载重新验证，运行时 permission denial 不阻止安全探测，但 capability 未实现及 policy 禁止仍然拒绝。静态 describe 成功不能证明实际读取已恢复；临时探测许可不向业务门发布。

只串行化短暂的本地 publication，不把 Provider 网络等待放入锁或 Storage transaction。查询捕获访问版本，完成本地一致读后复验；若版本变化，重读安全本地快照。恢复能力必须在完整投影与 cursor 已取得 Storage ack 后才发布。

### 拒读、离线与时序

完整源的明确 PermissionDenied 将当前 key 立即设为拒读，递增访问版本；每条 Planning 投影在同一 Storage transaction 中变为 redacted、planningStatus=unknown、planningFields 清空。保留稳定 entity、membership、外部身份和工程谱系用于恢复；这些身份不因撤权重新识别。wire 继续使用现有 redacted 规则隐藏 native locator。来源名在拒读时不外发，只有新完整成功提交才重新发布。

投影内容变化才 `advanceRevision`，与 redaction/cursor 原子提交；重复拒读无内容变化不循环推进 revision，也不推进 reconciledAt。拒读事务失败时内存拒读保持生效：查询遮罩或安全拒绝，Start Work 拒绝，命令如实返回持久化失败。不能因为写不进库重新外发旧缓存，也不能声称已持久化。

Offline、Unavailable、RateLimited 和普通暂态失败保留原许可内容、身份及最后确认时刻，标 stale；Planning 相关写准入和新的 Start Work 为只读。明确拒读优先于暂态离线，后续离线不能清掉既有 mask。NotFound 只有 Provider 契约明确表示整个源失去可见性时才能视为拒读；普通不存在或行级 unanchored 不得升级为全源 denial。

继续使用现有 Planning round 裁决普通完整快照的先后，并额外检查 access epoch。拒读观察在其捕获的 epoch 仍当前时生效，使所有此前启动的成功失效；不能仅因该失败的 round 比较旧就忽略可信拒读。已经被后续完整恢复替代的旧 epoch 失败必须被消费并忽略。只有拒读之后启动、同 binding/key、完整分页和事务均成功的新轮才恢复，部分页、getProject/describe 成功及旧成功均无效。

例：旧读 r1、另一读 r2 在途，r1 收到可信拒读，则 r2 的旧 epoch 成功无效；拒读后 r3 完整成功恢复，r1/r2 的任何迟到成功或失败均不能再次改变状态。refresh 单飞仍复用正常在途轮，但失效的旧轮不能永久占住后续恢复入口。

### 命令与客户端

`startTargetError` 在最早目标检查和现有写前事务内复用当前 Planning 访问/同步判断，先于 replay、ledger、context、Provider 调用。撤权后重放旧 saved key 也拒绝。这个 PR 只改该 helper 及其事务参数；已开始的外部步骤逐步门属于后续 operation 闭环，与 #204 的 admission/provision/execution 修改顺序集成。**Superseded by Decision Log「独立对抗复验与首次写门」（2026-10-30）**：真实反例证明 helper 返回后的准入与 replay 等待同样属于 A，须覆盖事务提交前、重放返回前及首次实际外部写前。

client/UI 允许 connected、存在 Planning 挂载且不 pending 时调用已有 refreshPlanning；允许探测不等于允许业务写。纯断连仍不发 RPC。失败文案区分 permission denial 与暂态离线，使用安全固定原因说明 `planning.item.read`、拒绝层、仍可浏览的本地工程信息和显式重新验证。成功恢复仅由新 Host 确认帧驱动，不凭 RPC resolve 设置内容、Saved 或确认时间。

放弃整体重装配 Host：会扩大故障域、等待旧 lease，且无法自动遮住旧库。放弃同 revision metadata 携带内容：现有 watch/client 将其视为违约。放弃 UI-only 遮罩：直接命令和其它读出口仍可绕过。

## Global Constraints

本任务文件集只在这里声明；新增文件先确认没有嵌套 AGENTS，调整边界先更新本节。

- `packages/core/src/runtime-access.ts`（新）：有界访问 owner。
- `packages/core/src/context.ts`：current access 接入。
- `packages/core/src/registry.ts`：仅抽取既有声明校验和求交。
- `packages/core/src/bootstrap.ts`：拒读、完整恢复及原子投影。
- `packages/core/src/queries.ts`：一致遮罩与来源信息。
- `packages/core/src/start-work.ts`：目标门、准入 epoch、事务提交与重放返回 fence。
- `packages/core/src/git-provisioning.ts`：复用 #204 的既有 `BeforeExternalWrite(operation)`，当前相对 stack base 无文件变化，不增加平行 API。
- `packages/client/src/planning-refresh.ts`：安全恢复入口与失败说明。
- `packages/ui/src/work-item-app.ts`：恢复交互接线。
- `packages/ui-model/src/work-item-list-view.ts`：仅必要安全原因。
- `tests/integration/runtime-planning-access.test.js`（新）：Core/fake/SQLite 判别矩阵。
- `tests/integration/harness-plugin-runtime-access.test.js`（新）：生产 Host/client/apply。
- `tests/integration/github-projects-bootstrap.test.js`：已有源级拒读必须遮罩的精确断言。
- `tests/integration/harness-plugin-workspace-setup.test.js`：runtime deny 优先于被改写的游标；保留未知错误脱敏负例。
- `tests/integration/planning-round-order.test.js`：受影响精确断言。
- `tests/integration/planning-snapshot.test.js`：受影响精确断言。
- `tests/integration/harness-plugin-host-planning-refresh.test.js`：受影响精确断言。
- `tests/integration/harness-plugin-planning-refresh-ui.test.js`：受影响精确断言。
- `docs/exec-plan/active/2026-10-30-planning-runtime-access.md`、`docs/README.md`：计划与索引。

本 PR 不修改 browser carrier；Node 生产 Host/remote/client/apply 组合必须在本 PR 完成，后续切片负责唯一生产 browser carrier 及跨域总验收。禁止用现有 browser fixture 手工 visibility 或合成 baseline 证明权限行为。

每 PR 的 code/test/config/fixture additions+deletions 必须严格小于 800，docs 严格小于 1300；不能只报净增。预测预算为 authority/事务/读门 280–340、client/UI 35–55、判别测试及精确断言 280–360，总计 595–755；这不是实测准入证明。留下空间处理已发现故障，超限先复用或删除已替代 dead code，仍超限就重新裁定真正独立闭环，不减验收。

无需已发布旧实验版本兼容，无 schema/data migration；不删用户库、不重置 policy、不改规划 Status/关系、不自动合并 PR。凭据仍仅 secret handle。中文正文、英文代码标识；遵守根 AGENTS、PLANS、publication 和依赖边界。

## Plan of Work

### Concrete Steps

判别测试使用固定 canary 和可控制的 Provider deferred，不用真实网络延迟制造竞态。以下顺序必须分别成例，不能用一个最终截图代替：

1. available → denial → 同轮 redaction publication，验证旧内容消失。
2. available → offline/rate limit，验证相同内容仍在但未新确认。
3. 旧成功在途 → 新 denial → 释放旧成功，验证不恢复。
4. 较旧轮的 denial → 已在途的较新成功，验证新成功也受访问 fence。
5. denial → 新完整 recovery → 释放旧 failure，验证不重新拒读。
6. denial → getProject 成功但第二页失败，验证不提前解锁。
7. denial → redaction transaction 拒绝 → 查询与命令，验证仍 fail closed。
8. denial → connected retry → 新完整 ack，验证同来源身份、Host 和客户端不变。
9. denial → 新命令及旧 saved replay，验证观察者计数与本地事实均无新增。

### Batch 1 · 锁住失败机制与预算

最小闭环是可以重复失败的 Planning 权限矩阵。涉及主文件为新 `tests/integration/runtime-planning-access.test.js` 与新 `tests/integration/harness-plugin-runtime-access.test.js`。先复用 fake/SQLite 和 host seed，以标题、正文、来源名和 wire external locator 的 canary 区分拒读与离线，记录当前反例；再以 deferred 控制真正 Provider 响应，构造上述两个时序、完整读取中途失败、redaction Storage 拒绝、direct 新 key/旧 saved key 及恢复入口。

在检出 `fix/planning-runtime-access` 的工作树根运行：

    pnpm test:file tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js

期望新行为断言先红，失败落在旧内容、旧 Saved 或自锁，不是导入/语法/夹具错误。此时按预算计算完整 diff 预测；若测试已挤掉实现空间，先复用既有 seed 和参数化矩阵。回滚点为本批新测试改动；不改用户数据或上游权限。

### Batch 2 · 实现权威撤权和恢复

最小闭环是 Core 在普通失败、可信拒读和完整恢复间一致转换。涉及主文件为 `runtime-access.ts`、`bootstrap.ts`、`queries.ts`、`start-work.ts`。按 Design 建立 current access/epoch，提交 redaction/revision/cursor，移动来源标题发布到成功提交后；在查询和写前事务使用同一判断。使用 fake 与 SQLite 同语义证明提交失败仍 fail closed。

在同一分支工作树根运行：

    pnpm test:file tests/integration/runtime-planning-access.test.js tests/integration/planning-round-order.test.js tests/integration/planning-snapshot.test.js tests/integration/start-work-sqlite-registration.test.js
    pnpm run typecheck

期望新用例全绿、旧身份与 revision 规则保持，Provider 副作用计数和新 ledger/context 均为零。回滚点为本批完整 coherence 修改；不要部分移除 query mask 或 runtime gate。

### Batch 3 · 生产链和恢复交互

最小闭环是同一生产 Host 已开详情经 watch 更新，拒读后按钮仍可触发实际安全重验证。涉及主文件为 `planning-refresh.ts`、`work-item-app.ts`、新 Host runtime 测试。使用真实 `createHostComposition`、SQLite、`installHostRemote`、Host watch 和生产 client apply/source；控制面只改变 Provider，不能改写 Controller 返回值或 wire capabilities。至少用 renderer 验证列表与已开详情；这仍是 Node 组合证据，不称为真实浏览器。

在同一分支工作树根运行：

    pnpm test:file tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js
    pnpm run boundaries

期望断连零 RPC，denied connected 可 retry，同 Host/客户端恢复，无 reload 或新 authority；来源名和 canary 不出 wire/store/HTML。依次临时取消 runtime gate、epoch fence、redaction，各有同一判别用例失败；在隔离副本做负控并逐字恢复，负控差异不提交。回滚点为本批交互/组合接线，保留 Batch 2 的安全结果直到整 PR 回退。

### Batch 4 · 交付收口

最小闭环是独立可 review、可回滚的 Planning PR。涉及主文件为本计划与 `docs/README.md`。完成日志、实际基线、命令结果、严格规模及五类发布面检查，整理提交后开/更新 draft；最终 push 后回读 head/base/checks/issue/review threads，达标才 ready，不自行 merge。

在同一分支工作树根运行：

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望全部相关检查成功；逐行累计 numstat 的增加和删除，非 docs 合计 ≤799、docs 合计 ≤1299，不能以仓库 size 1000/1500 替代。最终 push 后由协调者运行 `gh pr view -R SingularityKChen/harness-projects <实际PR编号> --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,reviewDecision` 并回读全部 review threads。命令中的实际编号来自创建结果，记录真实证据；此处没有执行声明。回滚为整 PR revert，分支改写遵循先 backup ref 再精确 lease。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 运行时拒读 | fake/SQLite 投影 redacted、规划字段清空、revision 内容变化才前进；Core 内容无 canary，wire/store/已开详情无 title/body/来源名/native locator |
| 普通离线 | 原许可内容和 reconciledAt 保留，stale/read-only；不是 fresh 空表，Delivery/Execution 本地事实不删 |
| 直接命令 | Core、Controller、Host 新 key 和旧 saved replay 均拒绝；Provider calls、新 mutation/context/run 为零 |
| 迟到成功/失败 | 拒读前读不能恢复；恢复前旧失败不能推翻已提交恢复；同 epoch 的可信拒读先 fence 再提交 |
| 持久化失败 | redaction 写失败仍无旧内容外发/无写准入，不假称已落库；重试可完成同一安全 publication |
| 恢复 | denied connected 的 refresh 可达，probe/部分页不解锁；同 binding 新完整成功才恢复，身份稳定 |
| 生产链 | 真 Host/SQLite/remote/watch/client apply/source/render 测试与隔离负控；无 controller mock authority |
| 交付边界 | 所有实测与 hosted CI 分列，严格规模达标；仅 Planning 子 issue 关闭，#457 总问题保持开放 |

## Progress

- [x] 2026-10-30（Asia/Singapore）：独立比较两份设计，检查 owning source，确定 Planning 纵切与后续完整验收边界。
- [x] 2026-10-30（Asia/Singapore）：创建本计划，记录基线漂移、拒读 epoch 与恢复顺序。
- [x] Batch 1：fake/SQLite 12 项新行为断言先红（修正夹具调用后为 revision、旧内容与旧 Saved 失败）；生产 Host recovery 按钮真实 RED 为 disabled。
- [x] Batch 2：Core 本地实现完成；最初 151 项相关回归通过。独立 review 推翻 helper 后仍可沿用准入的假设；新增 replay、claim、首写与 standalone sync 反例均先 RED 后修复，当前 runtime 23 项与 Host 5 项通过。
- [x] 2026-10-30：Batch 3：真 Host/SQLite/remote/client.apply/render 的正常拒读恢复与事务失败 gap→同修订安全 baseline 已通过；gate、epoch、redaction 三个隔离副本负控分别按期失败。
- [x] Batch 4：完整本地2660+7、独立原/首写窗口探针12/12及组合426、协调者双方301通过；源head5163bcb的PR Fast Gate/Verify/Merge Gate/规则已回读成功。归档最终head仍需重新回读检查、双向closing和全部线程后才ready；不合并。

## Surprises & Discoveries

首轮 `pnpm verify` 的 2575 项测试有 3 项失败：GitHub Projects 两个 Storage 的旧断言要求 PermissionDenied 保留明文；workspace setup 旧断言要求游标篡改能覆盖内存 deny。已修正精确预期，同时保留普通离线内容与未知错误脱敏检查。

实际 SQLite 的 redacted 行省略 `planningFields`，不能显式置为 undefined 后与读回直接深比较；`redactPlanning` 删除该属性，使重复 denial 不额外推进 revision。

磁盘 redaction 事务故障时 Core 保持内存拒读，controller 的现有同修订业务变化守卫发 gap，真实 client.apply 在同一 source 重开 gen2 的安全 baseline；SQLite revision 没有虚增。证据为新 Host runtime 测试的 `gap r=1 → baseline r=1 gen=2 → 磁盘恢复后 delta r=2`。

恢复来源标题被移除时，客户端须保留最近一次真实挂载 scope，不能把 name 缺失当作工作区切换；没有挂载的全 unavailable key 列表仍不发 refresh RPC。已拒读后的 offline 重试继续显示拒权原因，不回退为许可缓存的文案。

`writePlanningStatus` 是尚未发货的独立 Core 入口：在 redaction 落库失败且 host_authoritative 的旧投影仍在时，只检查旧投影可能改写本地隐藏行。当前 Host `OPERATIONS` 没有暴露该命令；A 明确只闭合 Start Work 新请求与重放，后续 #457 C 必须评估该最小 runtime 写门。本切片没有修改 Status 或 policy，也不声称全部 Core 规划命令已闭合。

独立评审在 `f55e0166b5a0671ee05a9eb74a4ebbcfa5ded7fa` 发现两项 P1、一项 P2：helper 返回后 ledger/claim 等待可跨越 deny；旧 epoch PermissionDenied 状态虽被忽略，错误原文却经真实 remote 外发；独立 getPlanningSync 的 healthy cursor 等待可返回旧 fresh。将原 6 个反例和额外首次 preflight 等待窗口纳入回归，7 项行为断言真实 RED。修复后原 6 个只读外部探针全部 GREEN，未修改探针、Controller 结果或合成 baseline。

事务内捕获的 admission epoch 在提交前复验，失效则整笔回滚；已合法提交的 admission 在后来首次写被拒时保留，返回 local context 的未确认状态，不谎报控制事实也为零。首次 Provider 写已经发起后的步骤不在本次撤回，不新增 C 的逐步门。组合版 latch 在既有 typed `BeforeExternalWrite(operation)` 首次回调先检查当前 epoch，再写 owned durable intent，事务尾与 ack 后再复验；后续回调只保留 #204 的持久化意图机制。若在 intent 事务中等待期间撤权，intent 回滚，但此前合法提交的 admission 保留。所有 PermissionDenied 按 code 固定安全消息，与其状态观察是否获当前 epoch 接受分开。独立 sync 仅复用 epoch 重读，不占 publication 队列；内容快照/详情仍保持原短 publication 排队。

既有刷新失败只更新 cursor，不能达到撤权；证据为 `bootstrap.ts::fail` 与 `queries.ts::planningSnapshot`。既有 recovery 同时被 client 和 UI 的 readable 前置挡住，故只改 Core 会形成无法自行恢复的产品。

已有 wire redacted 规则会隐藏 externalKind/externalId/planningFields，应复用；不得因原始 Core 投影保留恢复身份而新增另一套 wire authority。既有来源标题在 Provider 读取中赋值，需与完整提交对齐。

`tests/fixtures/execution-drawer-browser.mjs` 当前改写 controller.getEntity 并合成 baseline，不能作为生产访问证明；本 PR 明确只声明真实 Node 生产组合，后续切片替换该 carrier 并真实浏览器复验。

## Decision Log

- Decision：选择当前 Core 的有界 operation 观察，复用 refresh、round、revision、wire 遮罩，不重装 Host。
  Rationale：拒读必须原地失效，局部故障不能扩大为整个工作区不可用。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。
- Decision：拒读与恢复以 access epoch 和完整提交裁决，普通 round 仍决定快照新旧。
  Rationale：仅比较 round 会漏掉较早开始但刚观察到的可信拒读；不比较 epoch 又会被旧失败反复撤回恢复。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。
- Decision：本 PR 独立关闭 Planning 子问题，后续 Delivery 与 shipped operation/browser 继续 #457。
  Rationale：保留完整验收，同时让每 PR 严格少于 800 行成为实际可检查门。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者；用户已授权持续执行。

- Decision：独立对抗复验与首次写门：A 必须覆盖 helper 后的准入与 Saved replay，以及实际首次 Provider 写调用；随后 stack 到 #204 / PR #467 的 `fix/durable-write-intent`，复用其既有 `BeforeExternalWrite(operation)`，不保留平行永久 hook。
  Rationale：真实 Provider deferred 已证明 claim 前后均可撤权，首次写前还会等待 preflight/baseRef；这是 A 的零副作用边界，逐步写门仍属于 C。首次本地修复用独立 callback 证明；已在 `fix/durable-write-intent` 的 `e7a723fdc25a4183964565bb6c3c32e37260ec8a` 上完成 rebase 与冲突整合，平行 callback 已删除，实际在同一 durable hook 中执行一次授权 latch。
  Date/Author：2026-10-30（Asia/Singapore）/ 协调者按用户已授权范围裁决。

## Idempotence and Recovery

refresh 可重复，重复 denial 不重建身份、重复完整成功不因内容未变推进 revision；reconciledAt 仅完整提交更新。失败探测不清 deny latch。publication 异常后保持拒读，再次 refresh 可重试；禁止通过删库或新 workspace 逃避状态。

断言/负控失败时回到该批已知基线，先恢复隔离修改再跑同一测试。已有外部 ack 不回滚删除真实资源；本 PR 的拒绝测试只针对准入前无副作用。整 PR revert 不修改 policy/schema，但会重新引入已知撤权漏洞，必须在回退说明保留这一风险。

## Interfaces and Dependencies

Node ≥22、pnpm workspace、现有 fake/SQLite、Host typed remote 和 client apply 是所需工具，不需要上游真实凭据。测试应复用 `tests/integration/fixtures/host-seed.js`，Provider deferred 和 fault 为唯一权限控制输入。

新增内部 owner 的最小契约是当前访问读取、I/O epoch 捕获/比较、可信拒读观察、完整成功提交后恢复，以及短 publication 的一致读；具体函数名由实现者选择，但不得新增公共重验证 command。`startTargetError` 的事务 storage 参数必须显式传入同一 authority，不在 transaction 回调调用根 Storage。

#204 仅拥有 admission/provision/execution，本 PR 仅与其协调 helper/调用参数（**Superseded by Decision Log「独立对抗复验与首次写门」，2026-10-30**：A 将 stack 到 #204 稳定 hook 上）；后续逐步写门在其稳定基线上串行接入。本 PR 必须自行推进 redaction revision；若组合测试暴露既有 client ordering 缺陷，显式记录并修复，不能以未验证的外部改动掩盖此责任。

当前内部 API 为 `epoch` / `denied` / `registry` / `probeRegistry`、`deny(captured)`、`recover(captured, verified?)`、`error()` 与 `local(work)`；它只负责当前唯一 Planning 挂载的 `planning.item.read`。deny 在 captured epoch 仍当前时立即递增 epoch；完整落库后 recover 再递增；普通成功不改变 epoch，round 继续裁决普通快照顺序。`local` 只串行化短本地 publication 和一致查询，Provider I/O 均在队列之外。`collectBindings` 原实现用于恢复时的严格重验证，不新增验证闭集或公共命令。后续 Delivery 如需 target scope，必须按其真实需求扩充，A 未预造通用平台。

没有接受新的技术债；Delivery、写门和 browser 是 #457 的后续独立范围，不能当作已完成。若实现为预算延期本切片必要安全行为，先更新 `docs/exec-plan/tech-debt-tracker.md` 与本计划并重新裁定，不以 debt 代替本表验收。

## Outcomes & Retrospective

本切片完成 Planning 运行期拒读、离线只读、权限恢复、来源/locator遮罩、Start Work准入/重放/真实首写前fence，以及真实 Host/SQLite/watch/remote/client.apply/render 的一致闭环。独立完整审读发现的2P1+1P2均已以真实RED修复，组合head `5163bcb7ad7c3e2aa878e3ebc2deaea879da8773` 限定复评原探针9/9、新首写窗口3/3、必要组合426/426，无新阻塞。

独立反例促成必要依赖：本PR以 `fix/durable-write-intent` 为base，复用其唯一 BeforeExternalWrite，不保留平行Git hook；A贡献非docs A+D720。父#204从e7a723f归档为47de6df时只改文档，本分支重放为7629792，packages/tests/scripts与已评审5163bcb逐字一致。

在A工作树完整 `pnpm verify` 2660+7、双方意图/Storage210、A48、九类负控、boundaries9、workflow8、发布面与diff检查通过；协调者另在组合运行301项通过。源码head的PR Fast Gate、Verify、Merge Gate与规则成功；CodeQL曾在平台上传阶段Server Error，最终归档head重新运行并在ready前核对，不将该故障写成代码分析通过。

本计划归档只改变文档；最终push后回读准确head/base/checks/双向closing465/全部线程后才置ready，保留人类合并决定。实际文档按最终size重算须<1300。当前证据是本地软件与hosted CI；不声称真实账号撤权、已安装Host UAT、完整#457/144或R1发布接受。Delivery与逐步门/唯一生产浏览器总验收仍在#457后续层。

外部actor=SingularityKChen，目标GitHub repository/project10，幂等键 `2026-10-30:465:delivery`；维护同一PR466及其双向关联、字段，规划Status和原生依赖未写。

### Artifacts and Notes

原始日志和负控差异保存在任务运行态目录；本计划保留命令、分支与真实结果。

## Bottom Change Note

- Change Note (2026-10-30 SGT)：初版；综合两份独立调查，收敛 Planning 完整纵切，明确可信拒读/旧失败的 epoch 顺序，排除伪 browser authority，保留全部后续 #457 验收。

- 2026-10-30（Asia/Singapore）：协调者按用户授权创建 Planning 子 issue #465 并关联父 #457；外部 actor=SingularityKChen、目标 GitHub repository/project10、幂等键=2026-10-30:457:planning-child；结果为创建成功及父子关联，未改 Status 或原生 blocked-by。

- Change Note (2026-10-30 SGT)：记录 Batch 1–3 的真实 RED/GREEN 与首轮全套旧断言冲突；扩充两个受语义修复影响的拥有者测试文件，不增产品范围。

- Change Note (2026-10-30 SGT)：本地 A 验证与三类隔离负控完成，记录 2579+7 完整验证、同 revision 磁盘失败恢复、后续 C 的未发货状态入口边界；独立复核和最终远端门未完成，保留 active，全部门通过后由协调者归档。

- Change Note (2026-10-30 SGT)：记录独立 2P1+1P2、7 个真实 RED 回归与 2586+7 GREEN；修正 helper-only 范围，保留首次已提交 admission 的真实边界；root 裁决 A 依赖 #204 并复用唯一写 hook，计划仍 Active 等组合后 scoped recheck。

- Change Note (2026-10-30 SGT)：A 已有界整合 #204 e7a723f，删除平行首次写 hook，改为同一 typed durable hook 的一次授权 latch与事务尾复验；补 intent-commit 回归和九类负控，记录210两方回归与组合完整验证，仍Active待scopedrecheck。

Change Note (2026-10-30 11:55 SGT)：记录独立三项修复、必要#204钩子整合与限定复评，源代码不变情况下归档A计划，最终新head门禁继续回读。
