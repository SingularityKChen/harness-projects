# 执行设置的原位反馈与独立读取恢复 ExecPlan

> 状态：Completed（工程代码切片；外部接受另计）
> 创建：2026-11-07
> 范围：Refs #553；最小工程闭环与人工接受分列
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`

## Purpose / Big Picture

启用一次后，同一设置页得到已确认、确定失败或可操作的 unknown。未知时可独立重新读取设置，既不导航重建 source，也不重复安装 pair 或启动执行。最小证据是真实 Host composition 接实际 client source 的 deferred 测试可原位恢复。

## Context and Orientation

`apps/harness-plugin/src/host-composition.ts:configure` 等待 old.leases 后安装、fingerprint/assemble，并以 barrier 隔离配置切换；`getWorkspaceSetup` 当前 executionInstalled 只检查持久 pair，随后又读 planning baseline。
`packages/client/src/workspace-setup.ts:run/installExecution/refresh` 依赖 command settle 后读设置；refresh 在 mutationPending 时 join，且 start 中还 while 等 mutation，永久 pending 无法自救。UI 真实入口为 `packages/ui/src/workspace-setup.ts`，不是 workspace-settings.ts。
#553 当次确切悬挂点尚未知。先定位 lease、assemble、ack、post-read 的边界；不能将“安装已落库”推成当前装配已启用。

## Design / Spec

继承 A/B 的真实链路红测与独立只读恢复；拒绝 UI-only toast、强制导航和重复 install。timer 只能结束当前等待，不证明 command 完成或取消副作用。
第一步通过真实 Host composition 与 client source，以 deferred gate 分别卡旧 lease、装配、command acknowledgement 与 setup post-read；记录最小 phase，不记录 secret/project content。先确定重现，不大范围改 Host 生命周期。
将安装 mutation 的 in-flight ownership/key 与界面 pending 分开。命令或确认读有界超时后显示 result_unknown，保留原 key 与在途槽，阻止第二 install；显式恢复直接调用 getWorkspaceSetup，不 join 原 mutation，不 refreshPlanning，不调用 install。使用可注入 deadline/scheduler 便于确定性测试。
late command/read 必须经 operation revision、workspace scope 与当前 source fencing；过期响应不能覆盖较新独立读。解除界面 busy 不释放原写的重复保护；确认读即使丢 ack，也可依据同 scope、Host 当前 assembly 已确认的 executionInstalled 结束界面未知状态。
Host setup 必须区分持久 pair 和 active assembly。独立 read 不可绕过正在提交配置的一致性 barrier 假装 current：barrier 尚未放行时允许有界 unknown；释放后 read 可确认；不等待失联 client command Promise。已保存但激活失败显示 activationError，不标已启用。
规划 degraded 与执行启用分别表述；已确认执行绑定不受无关规划 freshness 折叠成永久 pending。自然键冲突、disabled/custom/malformed pair 仍保留拒绝；不改分配算法。按钮有 label、status 文案可读，unknown 默认动作“重新读取设置”，确定失败才允许显式再试。

## Global Constraints

唯一 owner 文件集：`apps/harness-plugin/src/host-composition.ts` 的 configure/getWorkspaceSetup 区、`packages/client/src/workspace-setup.ts`、`packages/ui-model/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`；本计划；下列 tests。
测试集合：`tests/integration/harness-plugin-setup-client.test.js`、`tests/integration/harness-plugin-host-recomposition.test.js`、`tests/integration/harness-plugin-workspace-setup.test.js`、`tests/integration/harness-plugin-host-execution.test.js`、`tests/integration/workspace-setup-commands.test.js`、`tests/contract/ui-workspace-setup.test.js`、`tests/contract/ui-workspace-settings.test.js`。不改 session adapter/start-work；#556 如改同 host-composition，须严格限 PR handler 段并由主控协调。

单 owner 修改本闭环；同一共享文件不同语义段仍先由主控协调接口。每 PR code/test/config 的 additions+deletions 严格小于 800，docs 严格小于 1300；不以净行数替代 changed lines，不删判别测试凑预算。
未发布 MVP 不增加 legacy migration、双读、旧 ABI fallback 或 v1/v2 恢复框架。SQLite schema 如需变化按当前未发布基线直接调整；仅验证新建数据库与本次格式 reopen，不要求旧二进制兼容。
禁止 merge、真实模型启动、修改 Planning Status、blocking/blocked-by、#552 或 `docs/product/demo.md`。不手改原验收数据库，不声称修复历史 unknown，不把 local tests 当 Desktop 接受。
保持单 Planning authority、Host 状态权威、工程轴与规划轴正交、Provider ack/reconcile 规则、权限遮蔽及凭据 handle 边界。源码不引用内部输入或本机绝对路径。

## Plan of Work

### Batch 1 · 定位真实 Host/client 等待边界

最小闭环：旧 source 的安装已持久但 pending，独立 read 无法恢复的判别复现。
涉及文件：`tests/integration/harness-plugin-setup-client.test.js`、`tests/integration/harness-plugin-host-recomposition.test.js`。
用真实 createHostComposition 与 createWorkspaceSetupSource；分别 gate old lease/assemble、drop ack、gate post-read；记录 install/read/activation 计数与 persisted pair。确保旧实现因 recovery join 或错误当前确认断言失败；不得只手工 mock UI setter。
验证：`pnpm test:file tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-host-recomposition.test.js`。预期新增红测命中等待边界；回滚仅该测试即可还原。

### Batch 2 · 独立 read、late-result fence 与 honest unknown

最小闭环：原页能恢复而第二次 install 始终为零。
涉及文件：`packages/client/src/workspace-setup.ts`、`apps/harness-plugin/src/host-composition.ts`、`packages/ui-model/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`。
实现有界等待与原 intent 重复保护、pure read recovery、当前激活确认；覆盖 activation failed、planning degraded、scope switch/dispose、late ack/read、确定失败再试、custom/disabled pair。Host 若遇 barrier 未释放，返回 unknown 并允许稍后显式再读，不伪造 success。
验证：`pnpm test:file tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/contract/ui-workspace-setup.test.js`。预期全 pass；安装 pair 仍恰好2，ExecutionContext/Run 与模型调用0。回滚只本批，不删除用户绑定。

### Batch 3 · 独立复核与发布门

最小闭环：独立评审当前实现及证据，准备可审阅 PR，不自动合并。
涉及文件：本计划的证据与结论章节。
先按下列精确路径完成判别红绿与相关回归，再运行 typecheck、boundaries、publication/size 与 diff 检查。code/test/config 超过 799 行或 docs 超过 1299 行时停止 push，保持能力闭环重新切片；不把未通过的用例标已完成。
在本计划分支工作树根执行：

```sh
pnpm run typecheck
pnpm run boundaries
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
```

预期命令 exit 0；仓库 size checker 的默认上限不能替代本轮更严上限。Git diff、numstat 和 commit 机械检查通过 argv/library 调用；公开面按 `docs/development/publication.md` 五类人工核对。
准备 draft PR 之后、最终 push 之后，由主控对当前 PR 显式 `-R SingularityKChen/harness-projects` 回读 head/base/checks、issue 关联及完整 review threads；这些是易失状态，不预写 SHA 或 pass 数量。
回滚点：保留本 PR 前基线；失败时只回退本闭环提交。已经公开的分支改写须 recovery ref 与精确 lease；未经人类指令不 merge。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 真实链路复现 | Host composition/client deferred 红测命中准确 phase |
| unknown 不伪造完成 | deadline 后无 Saved，无第二 install |
| 独立恢复 | getWorkspaceSetup 可以独立调用，当前激活后原页 confirmed |
| 未激活/failed | persisted pair 不等于 enabled，activationError 可见 |
| late/scope | 较旧 response 不覆盖新读，dispose 后不 publish |
| 无额外副作用 | pair=2，模型/执行调用=0，原冲突约束保留 |

共用接受门：准确记录红测如何失败、绿测命令与输出、执行分支和时间；scope、permission 与 late response 反例通过；当前 head 的 hosted checks 和人工接受单列，缺失即写未验证。

2026-11-07 SGT，在检出 `fix/execution-setup-feedback` 的本任务工作树根运行：

```sh
pnpm test:file tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-workspace-settings.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-host-execution.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js
pnpm run typecheck
pnpm run boundaries
node scripts/workflow-check.mjs
```

F1 修正前 `8e5512df` 的观察结果：相关回归 146/146，typecheck exit 0，boundaries 9/9，workflow 检查 exit 0。全量测试的唯一标签选择器失败已在这轮相关回归中修复并复验；按主控要求不机械重复全量，组合检出可另给最终完整证据。

F1 修正后，在同一分支工作树运行：

```sh
pnpm test:file tests/contract/ui-workspace-setup.test.js tests/contract/ui-workspace-settings.test.js tests/integration/harness-plugin-host-execution.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-workspace-setup.test.js
pnpm run typecheck
```

2026-11-07 SGT：定向回归 85/85，覆盖新增两类读失败、真实 Host 安装及必要 UI 消费者；未重复完整测试。两条红测均准确断言：一次恢复读失败后，下次 UI 读预算结束仍 pending。修后保留原 key、install=1、规划 degraded 与 late fencing。

## Progress

- [x] (2026-11-07 SGT) 完成 A/B 独立方案核对、真实路径与现有接口调查，形成最终最小 spec。
- [x] (2026-11-07 SGT) Batch 1：真实 Host/client 红测原实现 5 pass / 5 fail；ack、post-read、丢 ack 三例仍 busy，缺少独立恢复，持久 pair 在 activation 失败后误报启用。
- [x] (2026-11-07 SGT) Batch 2：安装交互有界、独立纯读恢复、当前 assembly 证明与晚值围栏已实现；真实 lease/assembly barrier、规划 degraded、custom/disabled、scope/dispose 反例通过。同步 pending 订阅者重入另获 2 次 install 的红测，修复为发布前预留同一交互槽。
- [x] (2026-11-07 SGT) 独立评审 F1 已按根因修复：执行后置读 rejection/null error 保留执行恢复身份，下一次 UI 恢复继续有界纯读；补判别红绿，原评审者 scoped re-review 已以实际 UI 恢复链和原反例确认 ADDRESSED。
- [x] (2026-11-07 SGT) 独立完整审读及 F1 scoped 复评通过，本地发布面/严格规模、Draft #560/#553 双向关联已核对。最终远端门依实时回读命令判定，不将本行当作 hosted CI 结果。
- 保留外部门：真实安装与人类接受未执行；本工程代码切片归档不替代该门。

- [x] (2026-11-07 SGT) 本轮 MMP P2-F1：真实 Host 与实际 UI 两条 activation readback 红测先红后绿；相关 87/87、最终整表变异 5/5 KILLED、typecheck 通过。另一评审者的独立复评仍是后续门。

## Surprises & Discoveries

`getWorkspaceSetup` 目前先由持久 pair 推导 executionInstalled，再读取 planning baseline；因此只修 client Promise 不足以防止把尚未激活配置显示成当前。必须将 Host 当前激活事实与 planning freshness 分离表达。

2026-11-07 SGT：实际修改保留 Host 的 configure/barrier/lease 生命周期，只在 setup 读确认当前 fingerprint、Harness assembly、执行域无 disabled 挂载和无 activationError；不增加 wire 字段或独立 Host 超时框架。client 默认 30 秒交互预算可通过 `interactionTimeoutMs` 注入；超时不取消写，原在途槽继续防重。专用 `recoverExecution()` 不等待原 Promise、不调用 install 或 refreshPlanning。规划 error 不阻止已确认执行意图结束。

真实 reopen 反例发现：human provider 工厂失败会被 restore 归入 disabled，而默认 Harness 仍可装配；因此只看 executionMode 不足以证明整个 pair 激活。红测先证明误报，再将执行域无 disabled 加入确认条件；ack 后缺少 active pair 的读回保留可恢复 unknown。无效配置会在 Storage open 时先 fail closed，不是同一个工厂失败路径。

独立评审 F1 推翻了“恢复读 reject 的既有测试足以证明持续有界”的假设：原测试只查安全错误与 scope，没有走下一次真实 UI 恢复按钮。`failure` 实际是 UI 恢复路由身份，不只是内部失败阶段；安装类后置读失败必须保持 `install`，否则下一次会走无界普通 refresh。结构化 null/error 与 rejection 保持同一纯读默认动作。

完整 `pnpm test` 的一次运行得到 3582 pass / 1 fail；唯一失败是 settings 的直接消费者按旧标签“重新读取”查找控件。主控批准将该消费者窄扩入 owner 范围并改为新标签“重新读取设置”，保留不重发安装断言。修后以相关文件回归验证；未把那次完整运行记录为全绿。

源码观察基线为 2026-11-07 的 `main`；用 argv `git rev-parse HEAD` 与 `git status --short --branch` 重读实际分支状态。测试路径已逐一通过文件枚举核验；标为“新增”的测试应由 Batch 1 创建，不是假称既有用例。

## Decision Log

- Decision：按本会话人类点名本 PR 的条件授权，完成非阻塞修复、独立复评、工程计划归档、提交整理和 rebase merge。
  Rationale：当前 install 激活错误保持原执行恢复归属；#553 工程 AC 由真实 Host/SQLite/client/UI 判别测试验证，新安装与人类接受单列。 Planning Status 与原生依赖不改。
  Date/Author：2026-11-07 SGT / 人类伙伴直接条件授权，评审协调者记录。

- Decision：人类明确批准将 #553/#554 提前纳入迭代 9，交付 #554/#553/#537 外部叶/#556 修订范围。
  Rationale：修复已出现的产品回执问题，并完成已点名能力；准入授权不包括 Status 或 blocking 关系修改。
  Date/Author：2026-11-07 SGT / 人类授权，主控转达，综合评审者记录。
- Decision：用有界等待暴露 unknown，并以独立 Host 纯读恢复；不以 timeout 模拟安装成功。
  Rationale：用户需要当下可信状态，原 intent 重复保护与 Host activation 证据缺一不可。
  Date/Author：2026-11-07 SGT / 独立综合评审者。
- Decision：真实重现集中在已有 workspace-setup 集成 fixture；允许修正直接消费者的新标签选择器。
  Rationale：复用真实 Host/remote/SQLite/client，保留原副作用与并发断言；不复制较大的 execution fixture。完整测试提供了该消费者必须同步更新的证据。
  Date/Author：2026-11-07 SGT / 实施 owner，主控确认。

- Decision：install 类确认读发现 activationError 时，将该结构化错误保留在 install 恢复归属中；用户的下一次显式 Retry 继续同一执行安装意图。
  Rationale：错误安全显示不足以证明恢复闭环；清掉 failure 会令实际 UI 把 Retry 路由到 Planning connect。该一行修复不释放未知在途安装槽，不创建新 key 或额外模型调用。
  Date/Author：2026-11-07 SGT / 本轮主评审分工的修复 owner；不包含提交、推送或合并授权。

## Idempotence and Recovery

原 install key 在 unknown 内保留；显式 read 无外写可重复。command 晚到不会启动新安装或回滚当前 setup。确定失败且无未决写后，新显式尝试才分配新 attempt。

所有读取和窄测试可重复。实施失败保留当前红测、准确失败阶段和已知副作用，不抹掉证据。未提交变更只撤本 owner 文件；数据库验证使用临时 fixture，出现新格式不可读则回到当前基线重建临时库，原用户数据库不动。

## Interfaces and Dependencies

执行上下文：检出 `fix/execution-setup-feedback` 的工作树根（仓库内 `.worktrees/execution-setup-feedback-20261107`）。采用仓库 Node >=22 与 pnpm 10.28.2；用 `pnpm install --frozen-lockfile` 满足依赖，不擅改 lockfile。
WorkspaceSetupSource 可新增专用 recover read 方法或将 refresh 的 pure read 语义显式化；必须同时更新现有接口消费者与闭集解析。不得为了恢复 planning 调用而引入 session 操作。
若实现新增公共 capability 或 wire 字段，生产路径与 strict validator 同时调整；不允许仅改 fixture 让 UI 有数据。

## Outcomes & Retrospective

2026-11-07 SGT：初始计划阶段未实现源码、执行红绿或创建 PR。Superseded by 本节实施结果（2026-11-07）。

2026-11-07 SGT 实施结果：Draft PR #560 与 issue #553 的 closing 关联由主控完成回读后才开始写行为测试。上述原位恢复已实现，执行测试从未调用真实模型，临时 SQLite 中没有 ExecutionContext/Run；disabled/custom 挂载逐字段保持。安装现场的确切悬挂栈仍未知，测试是可控的真实 Host/client 边界重现。实际 Desktop 安装和人工接受保持范围外未验证，不作为本工程 PR ready 的前置；独立复核、最终 hosted checks 与远端回读由主控完成。
当次实际 Desktop 卡点若只能被 synthetic 复现而未取得原栈，保留不确定性；不得在 #553 宣称原安装验收已完成。主动延迟的可靠性任务列技术债追踪。
Superseded by 2026-11-07 本轮工程归档：该代码切片已修复并经独立 MMP 复评，计划归档；实际安装及父项接受继续由现有工作项跟踪，不能被工程归档替代。

最终发布门在本分支根运行 `gh pr view 560 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup`、`gh pr checks 560 -R SingularityKChen/harness-projects` 并完整回读 review threads；期望 head 与本地相同、base=main、closing 关联存在且必需 checks 通过。独立 F1 连续恢复反例已由原评审者重新执行确认 ADDRESSED，未发现修复新增的重要破坏；无需大范围重构。

**本轮 MMP P2-F1 修复（2026-11-07）**：client 在 install 类读回中将 activationError 作为 unresolved 错误保留，从而携带 failure=install；实际 UI 的 Retry 回到 installExecution，保留原 key。原未知/在途槽及纯读恢复逻辑未改。

在本分支工作树执行 `node --test --test-timeout=10000 --test-name-pattern="execution activation readback" tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-workspace-setup.test.js`：2 fail→2 pass；F1修正后的同一五文件窄测 87/87。真实 Host/SQLite 用例保持 pair=2、run=0；实际 UI 用例 Planning 写入=0、两次显式 install 使用同 key。`node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/560-mutations-final.json`：5/5 归因 KILLED、还原后基线绿；新增变异恢复旧 unresolved 分支，准确命中两条新测试。新 Desktop 安装人验未执行，仍按原接受门保留。

## Bottom Change Note

2026-11-07 SGT：综合 A/B 与真实源码，冻结最小纵向闭环、判别测试、owner 边界和恢复门；修正不存在的路径与未发布兼容负担。

2026-11-07 SGT：记录真实红绿、最小 client/Host 修复、边界反例及完整测试发现的直接消费者扩展；区分工程验证和 Desktop 人工接受。

2026-11-07 SGT：按独立评审 F1 保留执行恢复路由身份，补 UI 连续恢复红绿与必要旧断言，记录 scoped re-review 门；旧实现由 `backup/setup-before-f1-20261107` 保留。

2026-11-07 SGT：主控记录独立验收结论与实时远端回读门，保留实际安装接受为单独状态。

- 2026-11-07：本轮 MMP P2-F1 保留 activationError 的执行恢复归属；加入真实 Host 与实际 UI 红绿测试、87/87和最终5项变异证据。

- 2026-11-07 SGT：560-F1 已修复并独立复评（实现相关87、独立49、最终整表5/5归因变异），工程计划归档；实际安装/人验另计。
