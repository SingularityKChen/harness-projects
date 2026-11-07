# 执行启动的持久身份与当前 Host 读取 ExecPlan

> 状态：Completed（工程代码切片；外部接受另计）
> 创建：2026-11-07
> 范围：Refs #554；最小工程闭环与人工接受分列
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`

## Purpose / Big Picture

一次开始工作在发送 prompt 前已由 Core 持久接纳原 session/request。初读或 acknowledgement 丢失后，应用只读原运行并保留 unknown；当前 Host 的 page ABI 可以读取匹配原 request 的 turn。最小成功证据为生产组合 SQLite reopen 后 create=1、prompt=1，恢复不增加两者。

## Context and Orientation

`packages/core/src/start-work.ts` 的 `startExternalRun` 先写 intent，再一次调用 Provider；`recordRun` 直到 Provider 返回才落身份。`packages/providers/execution-harness/src/provider.ts` create→prompt→read，后两阶段异常会丢掉 ref。现有 `recoverAttempt` 要求原 `ExecutionRunRecord.providerRef`，`owned` 以 provisioningGeneration 围栏。
`apps/harness-plugin/src/host-session-adapter.ts` 实际调用 raw.inspect；当前安装 0.2.2-rc.1 服务只有 page。page 输入包含 address、maxMessages、throughSeq、beforeSeq，响应 `{cursor,records,hasMore}`，event record 是 `{type:'event',event}`。这些是读源码事实；当次历史异常栈仍未取得。
现有 `tests/contract/host-session-adapter.test.js`、`harness-execution-contract.test.js` 与 start-work recovery/owner-fencing 集成可直接扩展，无需新建另一运行账本。

## Design / Spec

选择 A 的 Core checkpoint 方案并继承 B 的当前 page 固定 cut 分页；拒绝只 catch 返回 ref，因为持久化前崩溃仍有已投递运行失联窗口；拒绝只换 ABI，因为 prompt ack 丢失仍丢身份。
保持 `ProviderStartRunInput` 可序列化；`ExecutionProvider.startRun(input, lifecycle?)` 的第二参数定义 `retainRunIdentity(ref): Promise<void>`，不进入 intent/fingerprint/wire。Harness 在 create 获得合法 sessionId 后构造安全 ref，await checkpoint 后才 prompt；没有 Core lifecycle 的直接 provider 测试可局部使用，产品 Core 始终传入。
Core checkpoint 在短事务内验证 workspace/context/run、generation、原 pending intent、binding 与当前准入，第一次写 Unknown run+ref，提交成功才 ack。重复同 ref 幂等，异 ref、已换 owner、变更 binding、权限撤销拒绝；Provider I/O 不进事务。沿用同一个 runId，不另建状态权威。
超时或 checkpoint 失败禁止 prompt，晚到 checkpoint 不得恢复发送。create 未回身份不承诺恢复；create 回身份到 checkpoint 间崩溃可能残留空 session，但没有 task 已投递。checkpoint 后所有异常路径保留原 ref；`recordRun` 不得用 undefined 擦掉已持久 ref；明确 prompt 拒绝保留身份并标确定失败，不自动 fallback 发第二任务。
内部 SessionPort.inspect 可保留归一方法名，raw 固定 page，不提供 inspect fallback。第一 page 确定 cursor，后页固定 throughSeq，beforeSeq 按当前最小 seq 严格递减；限定页数与总 deadline，验证安全整数/cursor/records/重复 seq 冲突。过滤事件后按 seq 归一，只投影 turn/source.rpcId/reason.kind，不泄 prompt/tool/error 内容。
必须找到匹配 request 的 user/message 并证明其 turn/start 与对应 turn/end，不能借别的 turn completed、list.running=false 或不完整分页判断成功。缺页、循环/空续页、permission/read 失败均 unknown。历史无 ref 的 #545 记录不从日志自动补齐。

## Global Constraints

唯一 owner 文件集：`packages/capabilities/src/execution-provider.ts`、`packages/providers/execution-harness/src/provider.ts`、`packages/core/src/start-work.ts`、`apps/harness-plugin/src/host-session-adapter.ts`；若规范必须更新，只改 `docs/architecture/harness-session-api.md` 当前版本观察段；本计划；下列 tests。
测试集合：`tests/contract/host-session-adapter.test.js`、`tests/contract/harness-execution-contract.test.js`、`tests/integration/start-work-execution-recovery.test.js`、`tests/integration/start-work-owner-fencing.test.js`、`tests/integration/harness-plugin-host-execution.test.js`。不改 storage.ts 或 Host composition；如需扩界先协调。

单 owner 修改本闭环；同一共享文件不同语义段仍先由主控协调接口。每 PR code/test/config 的 additions+deletions 严格小于 800，docs 严格小于 1300；不以净行数替代 changed lines，不删判别测试凑预算。
未发布 MVP 不增加 legacy migration、双读、旧 ABI fallback 或 v1/v2 恢复框架。SQLite schema 如需变化按当前未发布基线直接调整；仅验证新建数据库与本次格式 reopen，不要求旧二进制兼容。
禁止 merge、真实模型启动、修改 Planning Status、blocking/blocked-by、#552 或 `docs/product/demo.md`。不手改原验收数据库，不声称修复历史 unknown，不把 local tests 当 Desktop 接受。
保持单 Planning authority、Host 状态权威、工程轴与规划轴正交、Provider ack/reconcile 规则、权限遮蔽及凭据 handle 边界。源码不引用内部输入或本机绝对路径。

## Plan of Work

### Batch 1 · 两个根因的判别红测

最小闭环：证明旧实现的当前 ABI 读取失败及 prompt 前无持久身份。
涉及文件：`tests/contract/host-session-adapter.test.js`、`tests/integration/start-work-execution-recovery.test.js`。
raw stub 仅 page，无 inspect；构造跨页 request/turn 与坏 cursor/空续页。通过真实 Harness provider→Core→SQLite，在 checkpoint commit 人工 gate 时断言 prompt=0；模拟 accepted prompt 后初读丢失，reopen 检查原 ref。用旧源码先得到预期失败，排除 fixture/import 异常。
验证：`pnpm test:file tests/contract/host-session-adapter.test.js tests/integration/start-work-execution-recovery.test.js`。预期红测因 ABI/持久身份断言失败；回滚仅新增测试即可恢复基线。

### Batch 2 · 同一 run 的 checkpoint 与安全 readback

最小闭环：发送任务前 durable ownership，后续仅读同一身份。
涉及文件：`packages/capabilities/src/execution-provider.ts`、`packages/core/src/start-work.ts`、`packages/providers/execution-harness/src/provider.ts`、`apps/harness-plugin/src/host-session-adapter.ts`。
实现冻结端口、事务围栏和 ref-preserving 结算；覆盖存储失败、late ack、权限撤销、owner takeover、prompt 明确拒绝/ack 不确定与 read 失败；继续使用生产 adapter 的 page fixture。
验证：`pnpm test:file tests/contract/host-session-adapter.test.js tests/contract/harness-execution-contract.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/harness-plugin-host-execution.test.js`。预期全部 pass，重启恢复 create/prompt 计数不增，checkpoint 失败 prompt=0。回滚只本批提交，保留原 run/intent。

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

验收边界：本表验证工程代码切片。#554 AC4 的原 installed 失败边界证据仍未取得，保持该 issue OPEN，不以当前 ABI 源码核对或离线绿色替代。

| 验收项 | 判定证据 |
|---|---|
| prompt 前持久 ownership | checkpoint commit gate/reopen 时 ref 已存，prompt=0 |
| post-create uncertain | 原身份仍可读，不自动 fallback，不重复 prompt |
| owner/permission fence | 旧 callback 不写新 owner，撤权不泄 ref |
| 当前 ABI | 仅 page 的 raw fixture 通过固定 cut/分页回归 |
| turn 归属 | 缺 request/跨 turn/坏页均不伪造 succeeded |
| 历史边界 | 不宣称已修复历史 #545 或完成真实模型验收 |

共用接受门：准确记录红测如何失败、绿测命令与输出、执行分支和时间；scope、permission 与 late response 反例通过；当前 head 的 hosted checks 和人工接受单列，缺失即写未验证。

## Progress

- [x] (2026-11-07 SGT) 完成 A/B 独立方案核对、真实路径与现有接口调查，形成最终最小 spec。
- [x] (2026-11-07 SGT) Batch 1 红测：修正 fixture 的绝对工作目录后，在计划提交的原产品源码上重跑，203 条中 18 条因 page/缺持久身份/prompt 顺序失败；无 import 异常。
- [x] (2026-11-07 SGT) Batch 2：checkpoint、固定 cut page、原 run 恢复及反例完成；计划窄测 340 条通过，完整验证见 Outcomes。
- [x] (2026-11-07 SGT) Batch 3：独立完整审读 spec/quality 通过，无新增 P0/P1/P2（该先前审读结论 Superseded by 本文件 Outcomes & Retrospective 的本轮 MMP P2-F1 修复，2026-11-07）；本地发布检查与 Draft #559/#554 双向关联已核对。最终远端门依下述实时回读命令判定，不把本行当作 hosted CI 结果。
- 保留外部门：真实安装与人类接受未执行；本工程代码切片归档不替代该门。

- [x] (2026-11-07 SGT) 本轮 MMP P2-F1：20 条新判别测试在原实现全部红，最小 run/receipt 快照围栏后全绿；相关 360/360、最终整表变异 6/6 KILLED，typecheck 通过。修复的独立复评由另一评审者执行，尚未以本地验证替代。

## Surprises & Discoveries

`recordRun` 目前在 status 存在而 ref 缺省时直接 put 新行，可能擦掉本次 checkpoint；必须在实现中修复此覆盖路径。当前 ABI 缺 inspect 是确定源码差异，但不是当时异常栈的完整证明。

完整回归首轮 3610 条中 8 条失败：6 条来自历史观测文档要求仅保留原九个二级标题，当前 ABI 说明改为末尾粗体段落；2 条来自已有并发写者反例，修复为区分本调用实际 checkpoint 与其他写者的 run，不能将并发赢家改判 Failed。相关 350 条回归和最终完整验证均通过。

反例另证明 final ref 与 checkpoint 不同会错误回显 foreign 句柄，以及 checkpoint commit ack 等待期间撤权会泄 ref；实现分别保持原 ref 并 Unknown、保留 run 且不回显句柄，两种 Storage 均覆盖。

源码观察基线为 2026-11-07 的 `main`；用 argv `git rev-parse HEAD` 与 `git status --short --branch` 重读实际分支状态。测试路径已逐一通过文件枚举核验；标为“新增”的测试应由 Batch 1 创建，不是假称既有用例。

## Decision Log

- Decision：按本会话人类点名本 PR 的条件授权，完成非阻塞修复、独立复评、工程计划归档、提交整理和 rebase merge。
  Rationale：本 PR 和最终 commit 使用 Refs #554，原 installed Host 实际失败边界 AC4 未满足，#554 保持 OPEN；其余 source/ABI 与离线恢复证据不升级为原现场根因或旧无引用记录修复。 Planning Status 与原生依赖不改。
  Date/Author：2026-11-07 SGT / 人类伙伴直接条件授权，评审协调者记录。

- Decision：人类明确批准将 #553/#554 提前纳入迭代 9，交付 #554/#553/#537 外部叶/#556 修订范围。
  Rationale：修复已出现的产品回执问题，并完成已点名能力；准入授权不包括 Status 或 blocking 关系修改。
  Date/Author：2026-11-07 SGT / 人类授权，主控转达，综合评审者记录。
- Decision：选择 Core prompt 前持久 checkpoint + 当前 page ABI 一体闭环；#554 PR 默认 Refs 父项直到原 issue 的历史验收边界明确。
  Rationale：两项根因任何单独修复都不能保证未来运行可恢复，使用既有 run/intent 保持状态权威与预算。
  Date/Author：2026-11-07 SGT / 独立综合评审者。

- Decision：lifecycle 与内部 retainedRef 元数据仅存在调用栈；原 mutation input 保持可序列化。明确 prompt 拒绝在已 checkpoint 的同一 run 上记录 Failed，禁止自动 fallback；其他写者已有的 run 原样返回。
  Rationale：不能因 checkpoint 的存在把未投递说成成功，也不能让一种拒绝触发第二执行者或覆盖并发事实。
  Date/Author：2026-11-07 SGT / 实施 owner，依据判别测试。

- Decision：保留 checkpoint 时同一事务取得的完整 run/receipt 快照；首次最终写入先同时比较两者，journal 落盘后的 receipt 事务再同时比较本轮 journal 与 receipt。发现较新事实就读回当前事实，不用旧 Provider 响应覆盖。
  Rationale：相同 owner/ref 不能证明观察仍新；必须覆盖新 running、终态和 receipt 单独变化，同时保留 journal 在 receipt 写失败后仍持久的已有契约。无 checkpoint 的既有取消结算保持原语义。
  Date/Author：2026-11-07 SGT / 本轮主评审分工的修复 owner；不包含提交、推送或合并授权。

## Idempotence and Recovery

相同 checkpoint ref 幂等；未知只 getRun。若原 mutation 已有 checkpoint，重复开始命令沿现有恢复路径，不 create/prompt。失败不得清记录或扫描全 session 自动匹配。

所有读取和窄测试可重复。实施失败保留当前红测、准确失败阶段和已知副作用，不抹掉证据。未提交变更只撤本 owner 文件；数据库验证使用临时 fixture，出现新格式不可读则回到当前基线重建临时库，原用户数据库不动。

## Interfaces and Dependencies

执行上下文：检出 `fix/execution-start-identity` 的工作树根（仓库内 `.worktrees/execution-start-identity-20261107`）。采用仓库 Node >=22 与 pnpm 10.28.2；用 `pnpm install --frozen-lockfile` 满足依赖，不擅改 lockfile。
#553 仅拥有 configure/setup 区，不与本项同文件；#537/#556 不依赖本项类型。当前 Host raw page 的 fixture 是脱敏调用结构，不提交安装包源码。
若实现新增公共 capability 或 wire 字段，生产路径与 strict validator 同时调整；不允许仅改 fixture 让 UI 有数据。

## Outcomes & Retrospective

2026-11-07 SGT：已完成本计划产品实现与离线工程验证；Draft PR #559 在实施前由主控建立。未启动真实模型或修改原用户数据库。

在检出 `fix/execution-start-identity` 的工作树根执行：Batch 1 的上述红测完成后，Batch 2 的完整窄测命令为 340/340 pass；`pnpm verify` 最终 exit 0（typecheck、contract/integration/e2e 3610/3610、mvp0 8/8）；`pnpm run boundaries` 9/9、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main` 均 exit 0。首次完整失败已在 Surprises 就地列明，未省略。所有命令依赖本工作树 `pnpm install --frozen-lockfile`，未改 lockfile。

所有新增当前 page ABI 的结构 fixture 均为 synthetic；既有 0.2.0-rc.2 录制保留，生产 Host 集成的 envelope 转换不计作新原始观测。历史原请求 failing Host 方法仍未取得异常栈；不能推定其最早故障必在 inspect。工程结果不声称修复历史无 ref 数据或完成 Desktop 接受。
显式保留：历史无 ref 恢复及原 Desktop 端到端接受仍未完成，记录在 issue，不引入未经批准的恢复命令。若实现主动留下可靠性缺口，按 `docs/exec-plan/tech-debt-tracker.md` 单列，不静默欠账。
Superseded by 2026-11-07 本轮工程归档：该代码切片已修复并经独立 MMP 复评，计划归档；实际安装及父项接受继续由现有工作项跟踪，不能被工程归档替代。

最终发布门在本分支根运行 `gh pr view 559 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup`、`gh pr checks 559 -R SingularityKChen/harness-projects` 并完整回读 review threads；期望 head 与本地相同、base=main、closing 关联存在且必需 checks 通过。独立审读核对当前 page owning source、checkpoint/owner/权限/并发写者及重启边界，无新增 P0/P1/P2（该先前审读结论 Superseded by 本文件 Outcomes & Retrospective 的本轮 MMP P2-F1 修复，2026-11-07），无必须的结构重构。

**本轮 MMP P2-F1 修复（2026-11-07）**：`start-work.ts` 在 checkpoint 事务中保存完整 run/receipt 快照，原始结算只在两者均仍匹配时写 journal；receipt 事务对该 journal 与 receipt 再次条件比较，失配只读回较新事实。没有按终态特殊放行；新 running 同样受保护。保留 journal/receipt 两阶段持久化，未引入新 schema、状态权威或 Provider 调用。

在本分支工作树执行 `node --test --test-timeout=10000 --test-name-pattern="checkpoint late|checkpoint final receipt" tests/integration/start-work-execution-recovery.test.js`：20 fail→20 pass；Batch 2 同一六文件窄测 360/360。首次相关回归 358 pass/2 fail，两条 `receipt-only finalization retains newer cancel state` 指出围栏不应扩大到无 checkpoint 路径；收窄后 360/360。`node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/559-mutations-final.json`：6/6 归因 KILLED、还原后基线绿；新增三变异分别去掉初次 run 比较、receipt 前 journal 比较、初次 receipt 比较，均命中各自测试。F2 的 `Refs #554` 和原 AC4 保留由主评审处理；原 installed 失败边界与安装接受仍未补证。

## Bottom Change Note

2026-11-07 SGT：综合 A/B 与真实源码，冻结最小纵向闭环、判别测试、owner 边界和恢复门；修正不存在的路径与未发布兼容负担。

2026-11-07 SGT：实施 owner 记录 Batch 1 红测、Batch 2 绿测、完整回归发现与修复，保持真实安装/人类接受和最终远端门独立。

2026-11-07 SGT：主控记录独立验收结论与实时远端回读门，保留实际安装接受为单独状态。

- 2026-11-07：本轮 MMP P2-F1 按真实并发反例修复；记录20红绿、首次回归失配及收窄后的360/360、最终6项变异。修复独立复评与远端门仍待主评审。

- 2026-11-07 SGT：559-F1 已修复并独立复评（实现相关360、独立221、最终整表6/6归因变异）；F2改Refs并保留#554 AC4开放。归档仅表示本代码切片完成。
