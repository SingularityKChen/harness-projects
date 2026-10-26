# 在执行端口适配 Harness 会话 ExecPlan

> 状态：Completed · 实现、独立验收与 MMP 评审通过，归档状态已核对
> 创建：2026-10-26
> 范围：issue #140；离线可验收的 session start/read Provider 与工作树目录通路；取消能力当前固定 unavailable。
> 上游输入：issue #140、`docs/architecture/harness-session-api.md`；按根 `PLANS.md` 维护。

## Purpose / Big Picture

执行上下文可以通过统一 ExecutionProvider 在已经确认的工作树中创建一次 Harness 会话；明确启动失败时保留分支与工作树并退到人工。运行完成只改变 execution 轴，规划状态保持原值。最小证明是实际录制会话夹具的无网络契约、Core fallback 集成与三种状态政策回归。

本 PR 独立合并后提供可注入的 Provider，Host catalog 接线归 #359，运行刷新归 #365；不把它描述为 Desktop 已使用此 Provider、真实模型成功或完整 demo 验收。

## Context and Orientation

`packages/providers/execution-harness/src/index.ts` 仍是包骨架。端口在 `packages/capabilities/src/execution-provider.ts`；Core 的 `start-work.ts` 已有 manual fallback 与 ambiguous_result→unknown 分支，但主执行输入没有工作目录。`git.worktreeExternalId` 是 Git Provider ack 后的规范路径，不能从请求的 branch 或 Host cwd 重新推导。

`tests/contract/fixtures/harness-session/session-api.json` 记录发行版 `0.2.0-rc.2` 的 create/prompt/inspect/list/cancel，包含重复请求键，回放必须按出现顺序消费。prompt/cancel 的 accepted 只是接纳，缺模型凭据可以在接纳后才出现 turn/end error。已结束会话重启后冷读有记录，运行中崩溃后恢复尚未观测。

本 PR 基于 main，在分支 `feature/harness-execution`、工作树 `.worktrees/harness-execution` 根执行。2026-10-26 观察基准为 `origin/main@d470308`；开始/交付用 `git rev-parse HEAD`、`git status --short --branch` 重读。协调者报告该基准 1927+7 项通过只表示基线。

## Design / Spec

方案 A：纯端口适配器，Host 后续注入 SessionPort；一 run 对应一个新 session、一次 prompt，inspect/list 读回。方案 B：全局 session 事件订阅器维护 run 镜像。选择 A：两份独立设计均支持，不引入事件乱序、补漏或 #365 生命周期。方案 C 通过 CLI 子进程或浏览器转发会新增目录/凭据事实源，舍弃。

公开工厂 `createHarnessExecutionProvider({bindingId,sessions,clock?,timeoutMs?})` 与定义 `HARNESS_EXECUTION_PROVIDER_DEFINITION={implementationKey:'execution.harness',domains:['execution']}`；包只依赖 domain/capabilities。SessionPort 使用 `session-probe-v1` 的归一投影 DTO 与 start/read 所需方法，无宿主 SDK import；不可直接传原始 ctx.sessionController。未来 Host 接线必须从事件 data 提取 turn/reason、从 data.source.rpcId 提取用户身份，过滤非 user 消息，并将同步方法包装为 Promise；本轮不实现或声称已验证该原始信封适配。

`ProviderStartRunInput` 新增必填 `workingDirectory:string`。Core 的主执行及人工 fallback 都传已 ack 的 `git.worktreeExternalId`；若这个阶段缺句柄则结构化失败，不能借 Host 默认路径。Harness 边界拒绝缺失、空白、非绝对路径及含 NUL；路径允许根/realpath 守卫仍由供应该工作树的 Development Provider 负责，执行者不能扩大允许根。

SessionPort 方法：`create({cwd})→{sessionId}`；`prompt({requestId,sessionId,mode:'queue',content:[{type:'text',text}]},signal)→{accepted}`；`inspect(sessionId,signal)→{events}`；`list({},signal)→{items}`；旧可选 `cancel({sessionId})→{accepted}`（Superseded by D6，当前不纳入 Provider 使用的端口）。每次 start/get 操作共享绝对时间预算，`timeoutMs` 缺省 30 秒，底层晚拒绝被消费；clock 只产生观测时间。

start 先校验 context 的本 binding/execution_context 身份、工作目录和输入，再 create→prompt→inspect/list。requestId 从 contextExternalId 稳定推导。command 仅作为一次性任务文本交给 prompt，不解释为 shell 指令；非空 environment 明确 not_supported、零会话调用，不能把凭据环境拼到 prompt。共享 execution 套件增加适配器输入项，让 Harness 使用空 environment，原 fake/human 的 canary 检查保持。

run ref 的 externalId 编码 `[sessionId,requestId]`，仅含不透明身份，不含 command/environment/cwd。getRun 解析该引用并按 `user/message.rpcId` 找到所属 turn，不能把用户后续 turn 的 completed 当成此 run 完成；无法确认所属 turn则 unknown。引用 binding/objectKind/编码先校验，返回始终由 Provider 重新构造，不回显 url/未知字段。新 Provider 实例可凭 ref 冷读，无本地 run 缓存。

状态优先级固定：所属 turn/end `completed→succeeded`、`error→failed`、`aborted→canceled`，未知 end→unknown；尚无所属终态且 running=true→running；有 turn/start 但 running=false→unknown；已接纳但未 start→starting。没有运行中 list 的 S3 证据，该分支用合成反例验证并注明证据级，不把它写成已录制事实。没有时间戳/退出码/日志 URL 证据时返回 undefined，不制造确认时间。

cancel 开启时仍先判能力再判身份；调用 cancel 后 inspect/list 读回实际状态。accepted=true 且仍 running 只能报 running，之后所属 turn aborted 才报 canceled；原 completed/error 保持原终态。共享套件保留真实 canceled 读回的强断言，Harness 另测非即时确认，不把套件弱化为只测 ok。 **Superseded by Decision Log D6（2026-10-26）**：当前五方法不支持条件取消，读前 preflight 无法消除 TOCTOU；本 Provider 取消能力恒 unavailable，任何输入恒 not_supported，零 SessionPort cancel 调用，不提供 cancel:true 开关。外部 Host 已产生的所属 aborted 仍读为 canceled。共享套件按真实 capability 决定是否写取消，声明可用的 Fake/Human 保留 canceled 强断言。

错误边界：gateway/bad-request→invalid_input，session/not-found→not_found，无 code 的 inspect 异常→安全 unavailable；create 明确不可用带阶段 create，prompt 明确拒绝带阶段 prompt。prompt 一旦调用后发生超时/不明异常，或已 accepted 后读回失败，返回 ambiguous_result，Core 记录 unknown 且不能启动第二 executor。缺模型凭据的 turn/end error 是已创建 run 的 failed，不能倒装成“启动未发生”。

create 未观察到幂等，requestId 只防同一 session 的重复 prompt；不能承诺跨崩溃 exactly-once，不自动重试 create、不删除空 session。外部调用记录规则：actor 取原 startWork 信封，target 为 execution ProviderBinding，intent key 为该上下文及原 idempotencyKey，prompt requestId 与返回 session/ref/结果阶段记入脱敏验收证据；Provider ack/read-back 分开记录。录制测试 actor 用明确 test actor。本 PR 不接 Host，不新增虚构的持久会话账本；#359 接真实调用时承担该记录接线。

官方依据于 2026-10-26 通过 HTTP 读取 `https://deepseek-harness.github.io/deepseek-harness/develop/basic/`：服务由 ctx 注入、清理归插件生命周期；五方法与状态语义仍以仓库录制版本为准，官网没有代替该 rc 兼容证据。

## Global Constraints

代码加测试严格小于 800 行，文档严格小于 1300 行；目标生产约 280、测试约 360、文档约 180，包含删除行。不得引入事件守护、prompt 策略、自动发布、Host catalog 或模型凭据配置；不修改 Status、blocked-by/blocking。

唯一文件集合：`packages/providers/execution-harness/src/index.ts`、`provider.ts`、`session-port.ts`（后两文件新增）；`packages/capabilities/src/execution-provider.ts`；`packages/core/src/start-work.ts`；`tests/contract/suites/execution.js`；`tests/contract/harness-execution-contract.test.js`（新增）；`tests/contract/fixtures/harness-session/replay.js`（新增）；`tests/integration/harness-execution-fallback.test.js`（新增）；`tests/e2e/status-policy.test.js`；`docs/README.md`；`docs/review/pr-402-mmp-review.md`；本计划。Human/Fake 已接收统一输入类型，无需实现虚构 cwd 行为；若 typecheck 证明另有生产调用点，先修订文件集合。

Session API fixture 保持原 provenance，不把合成 running/crash 案例混入历史 S3 录制。#277/#354/#131 不编辑本文件集合；此 PR 无父栈。

## Plan of Work

### Batch 1 · 工作目录与录制回放合同

**最小闭环**：执行端口收到已 ack 工作目录，录制五方法可按重复键顺序回放。
**涉及文件**：`packages/capabilities/src/execution-provider.ts`、`tests/contract/fixtures/harness-session/replay.js`、`tests/contract/harness-execution-contract.test.js`。
先 RED：Host 默认 cwd 与工作树不同；缺路径零 create；相同 create/list/cancel 键不同结果按顺序返回；network spy 为零。实现窄 SessionPort、ref 编解码和回放 helper；保留原始 fixture，request 文本/cwd 的占位替换必须由测试显式声明。

    pnpm run test:file tests/contract/harness-execution-contract.test.js tests/contract/harness-session-api-record.test.js
    pnpm run typecheck

期望：先因缺实现红，再变绿；fixture 无未知请求、无未消费的本场景请求、无网络。回滚本批端口/回放，不动原录制文件。

### Batch 2 · 启动、读取、取消与不确定结果

**最小闭环**：真实 result shape 通过共享 execution suite，终态、取消拒绝和失败阶段可判定。
**涉及文件**：`packages/providers/execution-harness/src/provider.ts`、`session-port.ts`、`tests/contract/suites/execution.js`。
先 RED 状态表：end 优先于 running、未知 end、未 start、崩溃形态、第二 turn 不冒领；取消 accepted 但未 aborted；foreign binding/kind/编码、恶意 url/额外字段；输入 canary 不入 ref。再实现 start/get/cancel 至 GREEN。原可用 cancel 部分 Superseded by D6：当前仅结构化拒绝取消写入，读取外部 aborted，验证 stale running、后续 turn、foreign requestId 和交错时始终零 session cancel。故障注入区分明确拒绝、prompt 已调用超时、已接纳后读失败，后两者必须 ambiguous_result。

    pnpm run test:file tests/contract/harness-execution-contract.test.js tests/contract/execution-contract.test.js

期望：原 fake/human suite 仍通过且可用取消仍严格读回 canceled；Harness 恒不支持取消写入，外部 aborted 按所属 turn 读回；重建 Provider 冷读一致。回滚 Provider 工厂即可恢复骨架；不取消或删除已存在外部 session。

### Batch 3 · Core fallback 与规划不变

**最小闭环**：明确执行失败保留工作树并 manual_fallback；不确定结果不启动第二执行者；成功/失败均不改变规划轴。
**涉及文件**：`packages/core/src/start-work.ts`、`tests/integration/harness-execution-fallback.test.js`、`tests/e2e/status-policy.test.js`。
先 RED：真实 Harness Provider 注入 Core，断言 create.cwd 精确等于 Git ack 路径；明确 unavailable→manual_fallback 且工作树仍可读；ambiguous_result→unknown、fallback 调用数零；三种政策下 completed/error 的 planningStatus 逐字不变。实现只补两处 cwd 传递，复用现有 Core 状态与补偿。

    pnpm run test:file tests/integration/harness-execution-fallback.test.js tests/e2e/status-policy.test.js tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js
    pnpm run boundaries
    pnpm verify
    git diff --check

期望：新测试 RED/GREEN 可复现、最终全命令 exit 0。回滚整个 PR 保留人工路线，不删除 worktree 或旧 run ref。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| start 明确失败后保留工作树并人工降级 | Batch 3 经实际 Provider 的 Core 集成 |
| 会话在 execution worktree 创建 | Batch 1/3 默认 cwd 反例，输入源为 Git ack |
| 完成会话不写规划状态 | Batch 3 三政策原值对照，零 planning writer 调用 |
| 契约离线通过 | Batch 1/2 录制回放、共享 suite、零网络断言 |
| 每种归一 host shape 只有一个 run status | 所属 turn 状态表，含未知原型键/空 history running 优先/冷读/外部 aborted |
| 取消不会中止其它 turn | 恒 unavailable/not_supported；Core stale running、后续 turn、foreign requestId、交错均零 cancel |
| 不确定启动不产生第二执行者 | prompt 超时/读回失败→ambiguous_result 集成 |

2026-10-28 是 issue 已决 cut checkpoint：未到可合并状态则 demo 保留人工执行路径；判断要回读当时 head、checks、review acceptance，不以本计划日期预判。适用会话证据仅 0.2.0-rc.2 的 web/回环 stub；本机较新 dsh 不在已录制兼容范围，不使用版本绕过。

提交前在本分支根运行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`，人工核对本轮更严格预算及五类公开面。最终 push 后以 `gh pr view -R SingularityKChen/harness-projects <实际PR号>`、`gh pr checks -R SingularityKChen/harness-projects <实际PR号>` 回读 head/base、issue #140 关联、所有 checks/threads；只有真实验证通过才 ready，由人类决定合并。

## Progress

- [x] (2026-10-26 16:32 +08) 审读两份独立设计、端口、Core fallback 与 session 录制，收敛此 spec；文件集合见 Global Constraints。
- [x] (2026-10-26 16:48 +08) Batch 1：观察工厂缺失导致 2 项 RED；最小实现后 cwd/输入拒绝 GREEN，录制重复键顺序、未知/未消费检查与零网络回放通过。
- [x] (2026-10-26 16:48 +08) Batch 2：缺 get/cancel、未捕获异常及共享套件缺 cwd 均观察 RED；补实现后录制/共享/既有 execution 共 74 项 GREEN。追加畸形 ack 反例观察 unavailable→ambiguous_result 的 RED/GREEN。
- [x] (2026-10-26 16:48 +08) Batch 3 本地实现：先观察真实 Git ack 目录未传入导致 create.cwd=undefined 的 RED；仅补 cwd 通路及缺句柄守卫后 Core/政策/start/recovery 70 项 GREEN，真实工作树内容可读。
- [x] (2026-10-26 17:18 +08) 独立验收修订 F1–F4：先观察 6 项 RED，恒拒绝取消、原型键 unknown、空 history running 优先及 Core 后续 turn/交错反例修正后 113 项通过，typecheck 与 boundaries 9 项通过。
- [x] (2026-10-26 17:22 +0800) 修订后最终全量回归：首轮1955/1956含下述计划外超时；同文件独跑10项通过，最后完整 verify 为 typecheck、1956主测试+7 MVP全部通过。
- [x] (2026-10-26 17:37 +08) 独立 scoped 复评 PASS，F1–F4 全关闭；113 项独立回归、原取消/交错反例零 Host 调用，共享取消负对照仍失败于强断言。本地实现闭环完成并归档，当前 PR 发布状态按本节末命令回读。

## Surprises & Discoveries

现有共享 execution 套件默认传非空 environment，而 Harness 不应把它持久到会话 prompt；须显式声明 adapter 输入，不可以静默丢弃或削弱所有 Provider 的泄漏检查。cancel accepted 对已结束会话也可为 true，绝不等于 canceled。

本机发行版已漂移至 0.2.1-rc.2 的协调者观测不能升级旧 fixture；没有本轮真实模型或 Desktop 证据。无 code 的 inspect not-found 异常不应靠原文正则伪装成稳定 error code。

2026-10-26 16:48 +08：补充反例发现 list 缺行不能覆盖已确认所属 turn 终态，缺失 turn 编号不能通过 undefined 相等伪认身份；修正后状态表通过。prompt 缺失 accepted 属于不明 ack，只有 accepted=false 才是明确拒绝。

2026-10-26 16:48 +08：typecheck 仅发现计划内 Core 两处缺 cwd 与 Provider binding 品牌类型，未新增生产调用点。规则脚本只扫描已提交差异，不能用此次未提交期间的通过声明代码已机械扫描；最终提交后须由协调者重跑。

2026-10-26 17:18 +08：独立验收发现 session.cancel 不能指定 requestId/turn，旧返回终态正确仍可中止其它 turn；按 D6 恒禁用取消写入，不用 preflight 假装消除竞态。额外补全原型键映射及 []+running 的优先级，明确归一投影不是原始 Host 合同。

2026-10-26 17:19 +08：修订首轮完整 verify 的主测试 1955/1956，计划外 `harness-plugin-host-planning-refresh.test.js:269` 的 10ms 读取返回 PlanningReadTimeout；同文件独跑 10/10 通过。未修改该文件或 Host 实现；保存首轮失败日志后重跑完整回归，不将该次失败隐藏或当作本轮通过。

## Decision Log

D1 · 2026-10-26 16:32 +08 / 独立计划评审者：窄端口、单 session/turn、引用携带 requestId。Rationale：避开 Host SDK 与事件缓存，用实际所属 turn 冷读，防后续 turn 冒领。

D2 · 同时 / 独立计划评审者：主执行和 fallback 统一必填工作目录；非空 environment 拒绝；未知 prompt 结果走 ambiguous_result。Rationale：执行目录唯一来源、凭据不持久、不得因错误分类制造第二 executor。

D3 · 同时 / 独立计划评审者：#140 独立 main PR，不含 #359/#365；不变更规划字段。Rationale：完整端口闭环可独立验收和回滚，demo 的真实 Host/模型门禁另有所有者。

D4 · 2026-10-26 16:48 +08 / Execution owner：requestId 直接取 contextExternalId；预算使用可配置 timeoutMs 的单操作绝对截止时间，晚 create ack 后不继续 prompt。Rationale：稳定身份不携带一次性输入；测试可在毫秒预算下判别超时，默认 30 秒不变。

D5 · 同时 / Execution owner：只把 accepted=false 判为明确拒绝，畸形 ack 保持 ambiguous_result；终态优先于 list 留存。Rationale：禁止用缺失数据制造安全重试或覆盖已观测终态。

D6 · 2026-10-26 17:16 +08 / 协调者裁决、Execution owner 落实：当前取消能力恒 unavailable，cancelRun 恒 not_supported 且零 SessionPort 调用；删除 cancel 配置及端口可用逃逸。Rationale：录制 M7 只支持 sessionId，无条件取消不能保证 run 所属 turn，preflight 无法消除 TOCTOU。仅有未来 Host 条件取消或可证明全生命周期排他时才另行设计启用，不承诺 #359 启用。issue #140 的取消是 optional。

D7 · 同时 / Execution owner：状态终态映射使用显式 switch；空 history 与 running=true 的重叠优先 running；SessionPort 明确归一投影。Rationale：原型键必须 unknown，优先级与既有录制文档一致，避免把投影合同误称原始 Host 兼容。

## Idempotence and Recovery

测试只创建临时对象并回放录制。prompt requestId 可重复，但 create 不具备已观测幂等，超时不自动新建；未知结果先读回现有 ref 或保留 unknown。worktree 由既有供应链保留；无 Provider ack 时不报 Saved。回滚代码不执行远端清理。

#193/#304 的跨崩溃恢复、TD-065 版本漂移、TD-066 真实模型/Desktop 仍保留原限制。发现新的必需遗留时在 `docs/exec-plan/tech-debt-tracker.md` 登记，不用未完成能力换取 #140 关闭。

## Interfaces and Dependencies

依赖只为 domain/capabilities、现有 execution suite 和录制 fixture，无新增运行库/凭据/网络。SessionPort 的 signal 仅约束适配器等待，晚 Promise 不能被当成未发生的写入。#359 将来承担原始 data/source 信封到归一 SessionPort 的适配、同步包装测试及真实调用审计，不是直接传 ctx.sessionController；取消启用不属于其自动承诺。#365 承担后续刷新。

## Outcomes & Retrospective

2026-10-26 16:48 +08：本地 Provider、录制回放、cwd 通路、Core fallback 与三政策验证已实现；执行上下文为 `.worktrees/harness-execution`、`feature/harness-execution`，基准 HEAD 仍是仅计划提交 `6570664`，实现尚未提交。首轮 `pnpm verify` 为 typecheck、1950 项主测试及 7 项 MVP 全通过；畸形 ack 修正后最终 `pnpm verify` 为 typecheck、1951 项主测试及 7 项 MVP 全通过；新增定向命令 23 项通过。`pnpm run boundaries` 9 项通过；`node scripts/workflow-check.mjs` 无发现。

2026-10-26 16:50 +08 用相对 origin/main 的 numstat 加未跟踪文件重算，代码及测试增删合计 446 行；文档约 159 行，均低于本任务预算。工作区 `git diff --check` 与五类公开面人工检查通过；正式 disclosure/size 规则待最终提交后重跑。本轮没有 Host 接线、真实模型、新版本或 Desktop 会话；原始录制 fixture 未修改。#359/#365 与原技术债务边界保持。保持 active 等待独立验收；不写规划轴、不代人类合并。

2026-10-26 17:22 +0800：F1–F4修订后，当前实现恒不支持取消写入，仅读取外部aborted；最窄113项、typecheck、boundaries 9项与最终完整1956+7均通过。一次计划外10ms PlanningReadTimeout失败保留日志且独跑通过；无跨owner代码变更。代码/测试增删528行，计划仍active等待独立复验。

最终独立验收（2026-10-26 17:37 +08）：F1–F4 全部关闭，剩余阻塞为 0；未通过 preflight 假装消除竞态。共享 Fake/Human 取消返回 running 的故障负对照精确失败，证明强断言没有被削弱。当前交付只启动/读取，取消恒 not_supported；原始 SDK 归一、Host 接线 #359、刷新 #365 和真实模型/Desktop 仍独立。无新持久账本、依赖或迁移，现有限制未伪装成完成。上面的“等待独立复验”结论 Superseded by 本段。

发布回读在检出 `feature/harness-execution` 的工作树根执行：`gh pr view 402 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`，期望本地与远端 head 相同、base=main、关闭关联只有 #140、当前有效 checks 通过；回读全部 review threads 后才 ready，issue closedByPullRequestsReferences 也须含 #402。人类决定合并，不以静态文档冒充 PR 现场状态。

外部元数据 actor=SingularityKChen，target=本仓 PR #402、issue #140 与 Project #10 对应 item；幂等身份=`iteration8-140-draft`。draft 创建及标签/里程碑/assignee、双向 closing、ExecPlan/Batch 已执行回读；归档后只机械更新计划路径。Status 与依赖边未写入。

## Bottom Change Note

2026-10-26 16:32 +08：合并两份独立建议并补齐 prompt 不确定结果、所属 turn 身份、cwd 与非空 environment 的判别边界，明确 #359 和真实 Host/模型证据不属于本 PR。

2026-10-26 16:48 +08：记录各批真实 RED/GREEN、Core cwd 集成、畸形 ack 修正和本地验证，区分录制/合成证据；按协调者分工保留 active 与未提交实现，最终 PR 回读交由协调者。

2026-10-26 16:50 +08：回填最终 1951+7 项全量与 23 项定向通过证据、含未跟踪文件的规模和发布面范围；无生产代码追加变更。

2026-10-26 16:53 +08：校正 aborted 录制为先 cancel 后 read，避免使用取消后记录冒充初始读取；随后当前代码树再次全量 verify 1951+7 通过，代码/测试 446 行。

2026-10-26 17:16 +08：独立验收 REVISE 后按协调者裁决就地废止可用取消方案，补 F1–F4 的最小修订规格；新反例先观察 6 项 RED，保留原 deadline/fallback/cwd/政策证据。

2026-10-26 17:19 +08：回填113项修订 GREEN、边界/类型检查、计划外10ms截止用例的一次全量失败和10项独跑通过；全量重跑结果待回填。

2026-10-26 17:22 +0800：回填修订后的最终1956+7全量通过及首轮失败记录，更新范围边界；停止实现树修改，交由协调者独立复验。

2026-10-26 17:37 +08：依据独立复评归档，明示取消不可用、投影合同和真实 Host 限制；发布现场以 current head/checks/threads 双向回读为准。

- 2026-10-26：MMP 评审订正过期 Active 抬头，使其与最终验收、completed 位置及索引一致；不改变产品范围。

- 2026-10-26：独立 MMP 复评关闭抬头 P3，原 E1–E6 变异在最终产品树重测全部精确 KILLED；评审证据纳入本 PR 文件集合。
