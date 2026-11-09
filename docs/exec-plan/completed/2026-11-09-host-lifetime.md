# 失败 Remote 撤回与有界 Host 卸载 ExecPlan

> 状态：Completed · Batch 2 独立复评通过，最终远端收尾按当前版本门执行
> 创建：2026-11-09
> 范围：issue #422 的 client mount 所有权、Host abort/drain 与用户数据保留
> 上游输入：issue #422、`PLANS.md`、`docs/adr/ADR-0013-harness-host-composition.md`

## Purpose / Big Picture

注入的客户端 child 初始化失败时，已挂载 remote 被准确撤回；Host 遇到永不完成的 Provider 时仍能在已测试的固定预算内卸载并重新加载。卸载会实际向 Host 拥有的 I/O 发 abort，使旧代等待和续接失效，保留已经发出但未确认的操作及用户数据。最小证据是实际打包 client 失败用例，加上真实 Host composition/remote/SQLite 的 never-settling、晚返回与重开测试；本地证据不自动等于真实 Desktop 产品接受。

## Context and Orientation

观察基线为 2026-11-09 的 `main` 提交 `c9bb17b833295f26c750bd8c4bf425df53e9701f`。`client.ts` 丢弃 `$mount` 返回 disposer，Cordis child 初始化异步失败不使父 `apply` reject。`remote.ts` 先等待 activeCalls 再撤注册，`host-composition.ts` 无界等待 pending 后关库；`host-planning-lifetime.ts` 的 stop 只拒绝下一次调用，当前 wait 仍等待 30 秒或永远等待其它 Provider。

Host 是唯一 SQLite/Core/Controller owner。当前 GitHub transport 已有逐请求预算，SessionPort 的 prompt/page/list 支持 signal、create 没有原生 signal 参数。execution Provider 在 session.create 后、prompt 前反向调用 Core 的 `retainRunIdentity`；仅 race 最外层 Promise 无法阻止这条晚 callback。`start-work.ts:startExternalRun` 将抛出的未确认 I/O 归为 AmbiguousResult，且 finally 关闭 callback；Storage 的共享 closed state 拒绝关库后的写入并回滚未提交事务。这些是可以复用的机制，不是无需测试的保证。

## Design / Spec

选择“明确资源 owner + Host 外部调用边界可中止 + 同一绝对期限排空”，三份独立方案均支持。拒绝只 race dispose 后关库，因为旧 continuation 仍可 prompt/checkpoint；拒绝全 Provider 公共 cancellation API 迁移，因为本闭环只管理 Host 自己的等待与资源。所有业务取消、清工作树、自动重放外部写、旧库迁移均不在范围。

客户端在任何 await 前登记根 effect，并观察 Cordis 公开 `internal/plugin` 事件中本根 fiber 的 uid 清空；即时 stop 只响应本根，不响应 injected child 的普通依赖重装。早期假设“仅提前 effect 即可中止 pending apply”已被真实 Cordis 推翻，Superseded by 本节启动所有权协议（2026-11-09 19:57 +08）。mount acquisition 由 stop gate 截断等待；迟到返回的 disposer 同样只释放一次，不向已卸载根注入 child。根 effect 拥有 mount；child 初始化失败显式调用同一 disposer，child 自己的 effects 继续撤回 panel/watch。正常根卸载与失败路径共享一次清理。不可恢复的 child 初始化失败后，恢复边界是根插件重新加载；不添加同根自动 remount/retry 状态机。依赖暂时移除/重新注入必须用真实 Cordis 4.0.4 语义判定：不能把每次 child unload 都当根卸载，也不能失败撤回后令重新挂载永久不可恢复。必要时给最小 `ClientContext` 类型补 root effect；不隐藏另一套 mount 状态。实际 bundle fixture 与依赖中的 Cordis 至少一条交叉验证 owner。

Host 状态单向 running→stopping→disposed。根 Host 在 profile、composition、remote acquisition 前建立 owner 与实际 Cordis uid-clear 观察器。首个 STOP/ERROR 才生成绝对 `deadline = now + 1000ms`，不是从加载开始计时；profile 等待可截断，composition 启动获得同一 signal 并登记所有尚在构造的 assembly，阻止迟到 mapping 发现继续 composeCore、启动 scheduler 或发布 remote。晚资源获取完成只执行原 deadline 的幂等清理；部分 remote 注册失败与正常卸载共用同一 disposer 和期限。同步关闭新 unary/stream/configure/tick 准入，停止 reconciler/watch，abort Host lifetime。remote 立即标 disposed、调用 unregister/provide disposer，再在同一剩余预算内等待 activeCalls；这两个外部 disposer 也不能各获得新预算或阻止后续 cleanup。重复 dispose 复用同一 Promise。Host 入口将同一 deadline 传给 remote 与 composition；直接调用 composition.dispose 的测试/消费者由它自己创建一次 deadline。时限仅约束支持的异步等待，不声称能中断阻塞 JS 的任意第三方同步代码。

扩展现有 app 内 lifetime 为拥有 AbortController 的 wait 边界：stop 立即拒绝已经等待的 Promise，删除 abort/timer listener；晚 resolve 不被采纳、晚 reject 被消费。包裹恢复后的 Planning/Development 数组/Delivery/Execution ports 的外部异步方法，保持 this、definition、非函数值与可选方法。新增端口和 Host I/O 仅受 stop 中止，不另加正常操作时限；原六类 Planning 读与 reconcile 预算仅由显式 Planning 域参数启用，其它域的共同 describeCapabilities 也不取得 Planning 预算；native adapter 等待显式为 Infinity，transport/session 自有预算保留，Infinity 不进入 setTimeout。reconcile 的 next/return 同样有终止边界。写方法在 stop 后必须抛出未确认的边界错误交给现有 Core 结算，不能返回“确定失败/已取消”的 ProviderResult，不能再派发下一步；即使底层晚返回 success，wrapper 也要复查 active 状态。

GitHub fetch 组合原 request signal 与 Host signal；credential resolve 与 response body 的等待同样可中止且后续 fetch 先检查 active。连接/仓库 preflight 也必须使用该 Host 边界，不能留 configure 队列的旁路。native SessionPort 在 call 内组合操作与 Host signal，对 raw create 的等待也 race Host abort，但保持原生 create ABI 不增加参数。截断位置必须在返回 session identity之前，阻止晚 create 后继续进入 checkpoint/prompt；prompt/page/list 的实际 raw 方法收到组合 signal。不得调用原生 cancelSession 来模拟卸载。

反向 checkpoint 单独受保护：Execution startRun lifecycle 参数的 `retainRunIdentity` 在调用 Core 前检查本代 active，并跟踪已经进入的 callback；stop 后不能新入场。已进入 callback 与 Core handler 属 drain，允许完成本地 durable uncertainty 结算后关库。测试必须覆盖 stop 发生在 create 等待中、checkpoint 已进入、prompt 已发出三处。Development cache 可跨重装配复用 raw port，所以其 transport 使用整个 Host 的 signal，不能捕获被 retire 的旧 assembly signal；每代暴露给 Core 的 wait wrapper 仍独立。正常 configure 先排空旧 leases 再 retire，不能把新 assembly 的共享 raw provider 随旧代一起 abort。

预算耗尽时记录现有安全诊断，最后 close SQLite 一次；已提交 intent/checkpoint 保留，未提交本地事务回滚，closed fence 拒绝旧代晚写。此 fallback 的成立依赖前面的外部等待截断和 callback fence，不能单独用 timer 加 close 充当实现。重开仅观察原目标，不新建 session/prompt/PR，不将未 ack 操作标 Saved 或已取消。若真实 fixture 证明无法隔离某条续接，停止扩大代码、修订设计；不能删反例压规模。

Batch 2 诊断设计（2026-11-09）：remote 的两个 disposer 仍同步启动、并行等待同一绝对 deadline；每个任务附拒绝处理，记录一次安全 shutdownFailed，并继续其它 cleanup。drainUntil 返回 false 时记录 shutdownDeadlineExceeded；晚拒绝也被消费并可记录。选择内部诊断 callback 接入 composition 已有日志和 describeError 允许名单，诊断 callback 抛错不得改变 cleanup。拒绝直接抛清理错误（会影响继续清理），不改 dispose 返回类型或引入结构化结果框架。正常卸载不记录失败，不延长 1000ms owner deadline、不开新公共 wire。

## Global Constraints

本 PR 的单一实现 owner 允许修改 `apps/harness-plugin/src/client.ts`、`host-surface.ts`、`host.ts`、`remote.ts`、`host-planning-lifetime.ts`、`host-session-adapter.ts`，及 `host-composition.ts` 的生命周期、I/O envelope、stop/dispose 区域，`host-providers.ts` 的 Host lifetime/session adapter 参数接线区域。测试允许 `tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、新 `tests/integration/harness-plugin-host-lifetime.test.js`、`tests/contract/host-session-adapter.test.js`；既有生命周期断言同步限 `tests/integration/harness-plugin-host-recomposition.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/integration/harness-plugin-host-planning-refresh.test.js`、`tests/integration/harness-plugin-host-runtime-adapter.test.js`、`tests/integration/harness-plugin-host-github-catalog.test.js`；root effect 与 mount disposer 夹具同步限 `tests/integration/harness-plugin-delivery-lineage.test.js`、`tests/integration/harness-plugin-execution-drawer.test.js`、`tests/integration/harness-plugin-runtime-access.test.js`、`tests/integration/harness-plugin-workspace-status.test.js`、`tests/integration/harness-plugin-setup-client.test.js`、`tests/fixtures/native-link-detail-browser.mjs`、`tests/fixtures/execution-drawer-browser.mjs`。文档允许本计划（完成后同名移至 completed）、`docs/adr/ADR-0013-harness-host-composition.md`、`docs/README.md`；有真实新增债务才改 `docs/exec-plan/tech-debt-tracker.md`。

工作分支 `fix/host-lifetime`，目录 `.worktrees/host-lifetime-20261109`。代码含测试/config/fixtures 加删严格小于 800、文档小于 1300；估计生产 210–300、测试 300–420，总 510–720，文档 180–300。无新增包、公共 Provider 契约、Storage/schema 或 Core 行为变更。#435 同样涉及 composition/providers，但只拥有 CI preflight evidence 与 assembly/configure 参数接线；交付 owner 顺序集成两个职责区域并重跑组合证据，两个 PR 均独立基于 main，不制造 native dependency。不改 Status、ADR Accepted、人类门或用户产物。

Batch 2 的实际写入限 remote.ts、host.ts、host-composition.ts 的内部诊断接线及既有 host-lifetime 测试、本计划与 docs/README.md 索引；不修改已有未跟踪 docs/review/pr-584-mmp-review.md。正式 review 5826007158 为 APPROVE 附一条 P2；本批不 commit/push/远端写，主控拥有最终整理、Issue 核销、归档与合并。

## Plan of Work

### Batch 1 · mount 撤回、abort、耐久排空与打包验证

**最小闭环**：失败面板撤回 remote；永不完成 Provider 收到 abort，旧代不能晚续接，Host 有界退出且原库可恢复观察。

**涉及主文件**：`apps/harness-plugin/src/host-planning-lifetime.ts`、`host-composition.ts`、`remote.ts`、`client.ts` 与新 `tests/integration/harness-plugin-host-lifetime.test.js`。

先仅以计划建立关联 #422 的 draft PR，由交付 owner 管理 GitHub 元数据。先写 artifact child 抛错后 mount disposer 精确一次的 RED；再写实际 Host never-settling fetch 与 native prompt 用例，断言底层 signal、remote 撤回、卸载结束、SQLite close once。当前实现应在 disposer=0、未 abort 或卸载超界断言失败，不接受因 fixture 缺方法而红。

按 Design 加入一个 deadline、active fence、可中止 wait、fetch/session signal 与 checkpoint guard，保持现有诊断漏斗。测试短预算可注入，外层墙钟上限留调度裕量；生产默认 1000ms 单一预算，不能为每阶段重置。补 late resolve/reject、停止前未派发零副作用、重复 dispose、dependency 重挂、setup preflight 被挂住、活动 watch 结束六类有判别力控制；已有 watch happy path 不复制。

写路径用真实临时 SQLite：prompt 已发出且 checkpoint 已落库后挂起，stop 后重新打开原库，原 run/receipt 保留 unknown 或 pending，provider ref 与 intent 存在，session/prompt 次数仍为一；另让 create 晚完成，确认没有迟到 checkpoint/prompt；checkpoint 已进入时先 drain 或回滚，晚结果不能写入新 Host。记录未确认结果不能用 business cancel/Failed/Saved 冒充。无网络、不启动真实模型、不访问历史用户库。ADR 原位补 bounded drain 取舍和当前支持 ABI，保留 Proposed 与既有人类裁决。

**验证**：命令在检出 `fix/host-lifetime` 的 `.worktrees/host-lifetime-20261109` 根运行。先在实现前运行第一行取得指定 RED，最终运行全部；期望相关 bundle、真实 composition/remote、late callback、SQLite reopen、边界均通过且 exit 0。

```text
pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-lifetime.test.js
pnpm test:file tests/integration/harness-plugin-host-watch.test.js tests/contract/host-session-adapter.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-retry-identity.test.js tests/integration/harness-plugin-host-recomposition.test.js
pnpm typecheck
pnpm boundaries
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
pnpm verify
node scripts/rule-checks.mjs disclosure c9bb17b833295f26c750bd8c4bf425df53e9701f
node scripts/rule-checks.mjs size c9bb17b833295f26c750bd8c4bf425df53e9701f
git diff --check c9bb17b833295f26c750bd8c4bf425df53e9701f
```

将 package load/unload 用实际构建 Host 入口与 Cordis effect fixture 验证；若能安全访问匹配安装件再观察 Desktop 无模型 unload/reload，单列 exact artifact 和结果。实际安装环境不可用时如实保留 installed 验收 gap，不把 artifact adapter 绿测称为 Desktop 接受。提交前人工 publication 五类目与更严 800/1300 numstat；完成后移动计划、更新索引。最终 push/Ready 前由交付 owner 回读当前 head/base、checks、issue 关联与所有 review threads，未通过不 Ready。

**回滚**：整体 revert 代码和文档；不删除 SQLite、run/receipt、用户 Git 工作树、文件或未知 session，不重放外部写。

### Batch 2 · remote 清理失败和期限耗尽的安全诊断

**最小闭环**：真实 Host 的正常卸载无误报，never cleanup 在同一 deadline 返回并记录 shutdownDeadlineExceeded；每个 reject 的 disposer 分别产生允许名单 shutdownFailed，仍继续清理、关闭 SQLite 一次，敏感错误原文不进入日志。

**涉及主文件**：`apps/harness-plugin/src/remote.ts`、`host.ts`、`host-composition.ts`、`tests/integration/harness-plugin-host-lifetime.test.js`。

先运行独立三模式复现并保存原始 RED；再补实际 applyHost + Cordis + 临时 SQLite 的 resolve/never/reject 回归，断言单一卸载预算、close once、两个 disposer 继续执行及敏感 message/stack/path/cause canary 不泄露。确认新断言因诊断缺失而红后实现内部安全 callback，重跑同一窄测试和独立脚本，随后 typecheck、boundaries、pnpm verify。错误只投影 name/code/errcode，不能把原始错误扩展至 wire 或日志。

**验证**：在检出 `fix/host-lifetime` 的本工作树根运行 `pnpm test:file tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-artifact.test.js`，预期先因两类诊断缺失失败，修复后全部通过；同目录运行 `pnpm typecheck`、`pnpm boundaries`、`pnpm verify`，期望全通过且零 skip/todo。独立脚本从主仓库根运行 `node .superpowers/pr583-pr585-review-20261109/pr584-remote-cleanup-diagnostic.mjs --root .worktrees/host-lifetime-20261109 --assert-diagnostics`，期望 resolve 无失败事件、never 有 deadline、reject 有安全 failure、exit 0。

**回滚**：仅撤销本批内部诊断接线与新增判别测试，保留 Batch 1 生命周期机制、用户 SQLite/外部未知动作和原评审文档。主控完成独立复评后才归档本计划。

## Validation and Acceptance

以 Batch 1 证据分别证明 mount disposer 精确一次、底层真实 abort、统一卸载上限、旧代续接 fence 和重开后的 durable uncertainty。只证明 Promise.race 返回、只用 fake storage、只断言 signal 存在都不满足。根 effect/child failure/reinjection 与 Host 注册/撤回必须经过包入口。业务取消、installed 接受与 R1 仍分别属于其原门禁。

## Progress

- [x] (2026-11-09 19:02 +08) 独立综合三份设计并核对真实 session、Core checkpoint 与 SQLite closed fence。
- [x] (2026-11-09 19:29 +08) Batch 1 本地工程：draft 关联已由交付 owner 建立；RED/GREEN、耐久对抗、包入口、全量与浏览器验证完成。
最终公开门：由交付 owner 在最后推送后回读 head/base、checks、issue 与全部 threads；本计划以命令定义门禁，不预写合并结果。
- [x] (2026-11-09 19:57 +08) 独立首轮识别 F1/F3 两个 P1 与 F2 一个 P2；一波完成六条新增 RED、修复、102 项定向和全量验证。
- [x] (2026-11-09 19:57 +08，后续完成) fix1 独立复评和正式 MMP 首审已完成；最终改写版本仍逐当前 head 回读，安装环境缺口单独记录。

- [x] (2026-11-09 20:06 +08) 独立 fix1 复评通过；F1/F2/F3 均 ADDRESSED，102 项定向、9 项边界、typecheck 和原始五条复现观察通过。

- [x] (2026-11-09) Batch 2：正式 P2 复现、诊断判别 RED/GREEN、窄回归与全量验证通过；本地修改交独立复评。
- [x] (2026-11-09) Batch 2 独立复评通过并归档，最终远端发布和条件合并由主控按当前版本门执行。

## Surprises & Discoveries

实施的首轮定向 RED 为 27/35，通过的是既有行为，8 个失败分别揭示 mount 未撤回、在途等待/remote 未截断及 create/prompt 卸载超时。首轮回归 263/264 的失败是旧 recomposition 断言等待 raw settle；首轮全量契约 1422/1423 同样要求迟后撤注册。对齐契约后全量集成 2036/2085 暴露 36 个缺 root effect 的旧夹具、3 个旧 drain/信号身份断言、1 个旧写确认时限假设、1 个策略优先级回归及 8 个迟到拒读回归。策略优先级由 admission 后延迟创建 Host I/O 修复；拒读回归来自新加正常时限在 fake Date 重置后丢弃原本应观察的否定证据，改为只在 stop 中止并保留既有正常预算，未改 Core 或放宽拒读断言。

native create 没有 signal 参数；在外层丢结果并不能阻止其后 `retainRunIdentity` 与 prompt。该 reverse callback 的 active/drain 保护是本计划关键修订。development raw provider cache 跨 assembly 复用，transport 若捕获旧 assembly lifetime 会误杀新代；需区分 Host I/O owner 与每代 Core wait owner。Storage 已有 closed/transaction fence，无需另造关闭机制，但必须用真实 SQLite 对抗验证。

独立首轮确认 b9810f5 的初轮绿测遗漏 mount acquisition、Host startup 和跨能力域预算。fix1 新增测试为 39/45（六个指定反例均失败）；仅将 effect 前移后的第一次 GREEN 仍为 42/45。Cordis 4.0.4 在 `Fiber.dispose` 先清 uid 并同步发出公开 `internal/plugin`，而 effect cleanup 要等 `_reload` 的 async apply 结束；因此必须观察精确 root fiber 的 uid-clear，不可依靠 effect 自行打断等待，也不用私有字段或轮询。进一步 GREEN 55/57 的两个失败为旧夹具假设“失败前尚无 root effect”和“effect 拒绝时已开 SQLite”；现改为验证已登记 owner 的 once cleanup 与尚未获取数据库，未弱化资源释放要求。

2026-11-09 Batch 2：正式评审发现 remote.ts 未使用 drainUntil 的 boolean，且 allSettled 消费了每个 cleanup 拒绝；composition 自身 pending 为空时不会补报 remote 缺口。实际 Host 的正常控制、never 与 reject 卸载时间有界，但后两者 diagnostics.log 无对应事件。此事实只推翻“诊断无新增缺陷”的结论，不推翻有界卸载、abort 与数据保留证据。

Batch 2 真实 RED：actual Host 新增三模式测试中正常 resolve 负控通过，never/reject 两项因 diagnostics=[] 失败；原生命周期文件结果为 17/19，错误不是初始化失败。独立三模式脚本先完整观察正常 0ms、never 1001ms、reject 1ms，再因 never 缺安全事件 exit 1。全部原始输出保存在 `.superpowers/host-lifetime-fix2-20261109/`。

## Decision Log

- Decision：单一 1000ms 绝对期限、先撤端点和 abort 再 drain，最后 close。Rationale：解决可达的无界等待并保留不确定外部写，不引入公共 cancellation 框架。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。
- Decision：session adapter 内截断 create，额外保护 reverse checkpoint。Rationale：防止关库后继续 native→Core 调用，外层 race 不足。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。
- Decision：当前批准覆盖自主可逆实现，真实人类/发布门不改。Rationale：工程事实不能替代规划接受。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。

- Decision：不可恢复 child 初始化失败后由根插件重载恢复；正常依赖重注入保留根 mount。Rationale：撤回 mount 会移除 child 自身 namespace 依赖，同根自动恢复需额外状态机；代价是该失败后用户需重载插件，真实 Cordis 包入口已验证新根获得新 mount。Date/Author：2026-11-09 19:25 +08 / delivery owner。
- Decision：新增 Provider/Host I/O 等待只响应 stop，不新增正常调用时限，原读与 transport/session 预算保留。Rationale：保持写确认时机与迟到否定权限证据；超时关闭仍受同一 1000ms 期限约束。Date/Author：2026-11-09 19:26 +08 / delivery owner。

- Decision：根 effect 保持资源 owner，公开 internal/plugin + 本根 fiber uid-clear 是 pending apply 的即时停止入口；phase acquisition 均受同一 owner 保护，error cleanup 与 unload 共用 STOP 时创建的 1000ms deadline。Rationale：真实 Cordis 证明 effect 单独无法解开 startup 等待；只匹配自身避免正常 child reinjection 被误停。Date/Author：2026-11-09 19:55 +08 / delivery owner，依据 pinned Cordis 4.0.4 公开事件契约。
- Decision：只有显式 Planning 域包装启用原六类读/reconcile 预算，其余端口含 native adapter 均 abort-only。Rationale：修复 F2 而保留各 Provider 原生预算，不扩大公共 Provider API。Date/Author：2026-11-09 19:55 +08 / implementation owner。

- Decision：按本会话针对 PR #583–#585 的条件授权修复 #584 唯一 P2。用户原话：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”Rationale：三条完整初审均无 P0/P1，正式 review #5826007158 的唯一行项属此授权；实现 owner 只执行可逆本地修复，独立 reviewer 与主控分别负责复评及最终外部操作。Date/Author：2026-11-09 / Batch 2 implementation owner。
- Decision：复用 composition 唯一诊断文件，经内部 callback 接收固定生命周期事件并 describeError 投影。Rationale：保持现有 owner、并行清理和绝对预算；诊断失败不改变清理语义，无新公共 API/wire 或权威源。Date/Author：2026-11-09 / Batch 2 implementation owner。

## Idempotence and Recovery

stop、mount cleanup、remote dispose、composition dispose 均幂等；重复 cleanup 共享 Promise，close once。晚 settlement 只消费，不激活旧端点、不更新新代、不重复外部 dispatch。失败保留用户库和原 intent，恢复只读取原目标；不自动清 unknown。测试临时资源由已有 fixture 生命周期管理。若不能证明某条晚 callback 安全，就保留未完成证据并修订本计划，而非将 timer 表面通过当闭环。

## Interfaces and Dependencies

依赖 Node >=22、pnpm 10.28.2、Harness 0.2.0-rc.2、Cordis 4.0.4 的现有 ABI。新增参数限 Host 内部可选 lifetime/deadline，不改 typed remote wire 或 Provider 公共方法。`createHostSessionPort` 保留 receiver 与 create/prompt/page/list 实际形状；信号是停止 Host 等待，不证明第三方动作已取消。诊断沿现有固定安全字段，禁止原始响应、token、prompt 或本机路径泄露。

## Outcomes & Retrospective

2026-11-09 实际新基线接合：#583 已合入 `main@1c28c7fc80607cb13ff05bcd71e93aa915233ee2`，本分支变基只解决双方 Completed 索引；独立复评的四个产品 blob 未变。候选 `695fbb7bd10a4a90b73991f3774769a9b15a1597` 重新完整 verify：typecheck、1423 contract、2126 integration、226 E2E，全部通过且零 skipped/todo；workflow-check、boundaries 9/9、publication/size/diff check 通过。记录补充不改变产品树，最终公开版本按后述远端门重锁。

2026-11-09 Batch 2 最终独立复评：F1 ADDRESSED，未发现新增可行动 P0–P3。独立 96/96 相关测试、原 actual Host 三模式 GREEN、主动抛错诊断 callback 的反例、typecheck、boundaries 9/9 和 diff check 通过；最终原八项加诊断 failure/timeout 的十项变异均按 killedBy 归因 KILLED，前后基线绿并还原。源码 blob 与补丁 digest 记录在 `docs/review/pr-584-mmp-review.md`；提交整理和实际 main 接合后必须保持本修复语义等价。工程闭环和独立复评已完成，计划归档；最终推送、Bot 当前版本批准、checks/threads/双向 issue 以及条件 rebase 结果继续用本计划命令回读，不预写成功。

初轮证据（b9810f5）：2026-11-09 19:29 +08，在检出 `fix/host-lifetime` 的工作树根目录完成本地工程验证。指定回归 264/264；扩展定向 129/129；迟到拒读、策略与生命周期组合 59/59；受影响五个浏览器文件的真实 Chromium 用例 39/39。`pnpm verify` exit 0：typecheck 与 contract 1423、integration 2085、E2E 226 全部通过，均无 skipped/todo。boundaries 9/9，pack:plugin 成功；实际新构建 Host 通过真实 Cordis effect 释放 remote 后重新加载同一空库，client bundle 通过真实 Cordis 验证失败释放一次、正常依赖重注入和失败后的根重载。

上述初轮完成结论对 startup/acquisition 的覆盖已由独立评审推翻，Superseded by 本节 fix1 结果（2026-11-09 19:57 +08）。fix1 在同一 `fix/host-lifetime` 检出运行：定向 102/102、权限/执行/watch 回归 293/293、受影响五个 Chromium 文件 39/39；`pnpm verify` exit 0，typecheck 与 contract 1423、integration 2091、E2E 226 全绿，无 skipped/todo。boundaries 9/9，pack:plugin 成功。review diagnostic 的五项输出现为迟到 mount 释放 1、40ms native/非 Planning 描述成功且 host 未 abort、startup discovery 卸载完成且实际 fetch 已 abort、partial register failure 已结束；对应新增判别测试而非 diagnostic exit code 承担验收。真实 Cordis profile/discovery/register 三窗口分别证明零迟到注册、原 SQLite 无额外写与 close once、非合作 disposer 在同一期限内退出。

真实 SQLite 覆盖 prompt 已发出后的 unknown/provider ref/intent 保留、create 晚返回零 checkpoint/prompt、已进入 checkpoint 排空，以及 80ms 测试期限耗尽时回滚未提交事务。create 与期限耗尽路径的晚结果在新 Host 已重开时释放，原键与替换键均不重复发 create/prompt。生产卸载共用 1000ms 绝对期限，remote 非合作 disposer 测试用 80ms 验证共享预算；这不声称能打断阻塞 JS 的第三方同步代码，也不声称 session 业务取消。

未访问已安装 Desktop 环境或历史用户库；installed unload/reload、独立代码验收、远端 Ready 与人类/R1 接受仍分别留在原门（独立代码验收部分 **Superseded by 本节下一段（2026-11-09 20:06 +08）**）。没有决定延期的新增技术债，回滚为整体 revert，保留所有用户数据库与外部未知执行。

独立最终复评（2026-11-09 20:06 +08，观察 head `b424d10b342bd921fd1cbde5dbeb8d52d6152139`）确认 F1/F2/F3 均 ADDRESSED，修复差异无新增 P0–P3。该轮“无新增 P2”的广义结论 **Superseded by Batch 2（2026-11-09，正式评审发现 remote cleanup 诊断遗漏）**。reviewer 用当前构建 client、真实 Cordis 与 SQLite 原样重跑五条独立复现，并运行 102 项定向、boundaries 9、typecheck、diff check；均满足预期。公开 root fiber/event 契约及普通 child 重载未误停已经独立检查。最终整理仅收敛提交身份并核对产品树不变；在最终 push 后用 `gh pr view 584 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup,closingIssuesReferences` 及全部 threads 回读，并完成 #435 组合验收。人类评审与 installed/R1 仍归原判定者。

Batch 2 本地结果（2026-11-09，未提交工作树，基于 head `cdb6f02e0237a9d678637263f2696d84063b88e4`）：lifetime + artifact 48/48；独立脚本 resolve 0ms / events=[]、never 1002ms / shutdownDeadlineExceeded、reject 1ms / shutdownFailed，exit 0。测试分别证明异步 reject 与同步 throw 的两个 disposer 各记一次，never 返回后晚拒绝仍消费并分别诊断；message/stack/path/cause canary 和临时根路径不进日志，日志错误字段恰为 name/code/errcode，SQLite close once。typecheck exit 0，boundaries 9/9；`pnpm verify` exit 0，contract 1423、integration 2094、E2E 226，零 skip/todo。输出分别见同一证据目录的 `green-lifetime-artifact.log`、`green-independent-diagnostic.log`、`typecheck.log`、`boundaries.log`、`verify.log`；完整日志不进入正式文档。

Batch 2 没有新增技术债、公共 wire、业务取消或数据迁移。实现只新增 remote 诊断 callback 与 composition 现有安全日志接线，继续使用唯一绝对期限、并行 cleanup、晚拒绝消费与 close once；未修改 `host-diagnostics.ts` 的允许名单。原实现者未改评审文档；当时计划维持 Active 等待独立复评。**Superseded by 本节开头 Batch 2 最终独立复评（2026-11-09）**：独立复评与归档已完成，提交整理、远端回读、Issue 核销和条件合并由主控接续。

## Bottom Change Note

2026-11-09 19:02 +08：创建最终单 Batch 计划，综合 mount 所有权、全 Host 等待边界、native 迟到 callback、缓存代际与统一 deadline；明确本地与 installed 接受区别。

2026-11-09 19:29 +08：记录实际 RED、全量失败及根因修复、abort-only 取舍、根重载恢复边界与本地验收；同步真实 Cordis 夹具，移至 completed 并更新索引。

2026-11-09 19:57 +08：fix1 根据独立完整评审修复 F1–F3，记录早期 effect 假设被真实 Cordis 推翻、精确 root 事件观察器、启动 acquisition 所有权、Planning 域预算和最终 RED/GREEN。初轮与本轮证据分开，独立复评仍未冒称完成。

2026-11-09 20:06 +08：交付 owner 登记完整初审后的 fix1 独立复评通过，进入最终单提交、远端 CI 与组合验收。

2026-11-09：根据正式评审唯一 P2 恢复 Active，追加 Batch 2、安全诊断最小方案、具体条件授权及独立复评门；保留旧轮次事实和用户数据边界。

2026-11-09：记录 Batch 2 的实际 RED/GREEN、48 条窄测试、独立三模式和完整 verify；本地实现完成，计划继续 Active 等待独立复评与主控收尾。

2026-11-09：登记 Batch 2 独立修复复评、96 条回归与最终十项变异通过，归档计划；最终公开与合并按当前 head 的门禁执行。

2026-11-09：在真实 #583 合入版本上接合、完整复验，补记产品 blob 等价及最终公开门规则。
