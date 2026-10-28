# 执行运行签发者刷新 ExecPlan

> 状态：Active；设计已收敛，产品实现尚未开始。
> 创建：2026-10-28；规范：根 `PLANS.md`。
> 范围：显式刷新一条既有运行，持久记录变化式健康度，并从详情按钮读回可信状态。
> Issue：[同仓 #365](https://github.com/SingularityKChen/harness-projects/issues/365)；分支：`feature/execution-run-refresh`。

## Purpose / Big Picture

用户点击现有“刷新执行状态”后，Core 向启动该运行的签发者调用 `getRun`，详情显示读回的状态及其确认时间。
提供方不可用时保留最后确认状态，明确标为陈旧；重复健康且同状态的刷新完全不调用持久写方法。
最小成功证据是两种 Storage 上的签发者、零写、离线恢复及取消交错测试，加一条真实 Host → client → 展示链测试。
工程完成、失败、取消、超时均不能推进 Planning 状态或业务修订号。

## Context and Orientation

事实所有者是 Host 组合的 Core；查询消费存储，前端不调用 Execution Provider。
`ExecutionContext` 是工作项与仓库的执行位置，`ExecutionRunRecord` 是该位置唯一既有运行；本次不增加第二次运行或历史列表。
`packages/core/src/execution-context.ts` 已返回存储的 `runStatus`；issue 旧正文关于缺少该字段的描述已由其规划说明取代。
`packages/core/src/execution-run.ts` 已有取消命令，按持久 `providerRef` 找签发 binding；Core 尚无 `getRun` 路径。
`packages/capabilities/src/execution-provider.ts` 已提供 `getRun` 和 `ExecutionRunRead`，无需增加 Provider port。
`apps/harness-plugin/src/host-composition.ts` 与 `packages/client/src/execution-context.ts` 均使用 DTO 白名单，必须显式传播新增字段。
详情现有按钮仅重读查询，故仅实现 Core 命令不能形成可触发闭环。
取证基线：2026-10-28 的 `main@88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；后续以执行分支回读为准。
上游架构依据：`docs/architecture/harness-session-api.md` §6、`docs/adr/ADR-0008-run-identity-is-the-core-run-record.md`、根 `AGENTS.md` §1.1。
业界对照采用 [Kubernetes ObjectMeta](https://kubernetes.io/docs/reference/kubernetes-api/common-definitions/object-meta/)：并发版本与用户可读时间不同；本次不照搬控制器或新建轮次基础设施。

## Design / Spec

### 推荐方案：既有运行事实 + run 作用域同步健康度

新增 `refreshExecutionRun(context, query)`，结果为 `{ ok, applied, error }`；`applied` 表示运行或健康度实际发生持久变化。
`CoreCommands.refreshExecutionRun(query)` 和 Controller 同名命令公开此能力；Controller 使用 `{ actorRef }`，不使用幂等重放账本。
成功读取属于 `local_only`；失败为结构化失败，不能显示外部写入的 `Saved` 或 `confirmed`。
路由依次检查 workspace、context/run 归属、持久引用及 `bindingForRef` 的完整工作区/binding/domain，再检查签发 binding 的 `ExecutionRunRead` 读权限。
只调用该 binding 的 `getRun`；新的默认执行器、主备切换均不能替代签发者。`read_only` 允许读，`unavailable` 拒绝。
返回引用的 `bindingId`、`objectKind`、`externalId` 必须与请求相同；`url` 不参与身份，不接受它触发运行重绑。
已知合法状态才确认；未知枚举字符串、明确 `unknown` 或畸形响应不能抹掉已确认 known 状态，按未确认观察标陈旧。
尚无 known 状态时保留 `unknown`；无运行仍为“尚无运行记录”，不合成 `running` 或新 run。

`runConfirmedAt = run.updatedAt` 表示“当前持久运行状态何时获得签发者确认”，不是最近一次轮询时间。
仅 known 状态且有合法签发引用、可解析时间时暴露确认时间；不得用当前时刻伪造确认。
同步健康度使用既有 `SyncCursorRecord`：键为 `(workspaceId, providerRef.bindingId, 'execution-run:'+run.id)`，`cursorValue` 保持 `undefined`。
健康度只存 `Healthy/Degraded` 与固定类型化错误码，不复制 run 状态、时间或 Provider 原文。
known run 没有该 cursor 时以启动 ack 的事实为 fresh；`runStale` 表示已知失败核对或本地已知签发能力不可用，不代表 TTL/SLO。
健康且同状态：运行、cursor、观察账本和业务 revision 全部零写，确认时间不变。
状态变化：一次事务更新运行状态/`updatedAt`；healthy → degraded 只写健康度；同错误重复零写。
stale → fresh 是健康度变化，即使状态相同也清理一次 degraded；此后相同成功零写。
该例外以完整观察状态发生变化为依据，不把“每次 poll 写 metadata”伪装成零写。

Provider I/O 在事务外；事务内重读 run 和对应健康度，复核 workspace/context/status/updatedAt 及完整引用身份后才提交。
与开始读取时快照不同则丢弃迟到结果，返回当前已存事实；运行与健康度一起成功或一起回滚。
同一 Core owner 内以 runId 单飞，释放在 `finally`；不将该内存机制宣称为跨进程最新开始序保证。
现有取消成功 ack 使用同一事务复核规则并清除此 run 的 degraded；不新增取消入口、权限或 UI。
确定性交错测试必须证明挂起的 running 读取不能覆盖已落库的 canceled。
不按状态枚举顺序猜进展，也不因 terminal 状态直接跳过 Provider 的真实读回。

查询新增 `runConfirmedAt: string | undefined` 与 `runStale: boolean | undefined`，只组合本地事实，不进行 Provider I/O 或持久写入。
Host 的命令与查询均在读取前后检查工作项仍可见、属于当前工作区且为 work item，redacted 不得调用 getRun 或返回旧详情。
保留 callable `ExecutionContextReader`，附可选 `refresh(scope): Promise<void>`；factory 可接该命令 port，普通只读消费者无需制造命令。
现有按钮显式调用 refresh 后重读；初始打开只读。调用失败后仍重读已持久的 stale 事实，并展示固定失败提示。
沿现有 target/generation/断连清理保护异步结果，多仓库分别刷新；ui-model 使用“此状态于 T 确认”“最后确认，当前无法核对”等准确文案。

### 拒绝方案与代价

拒绝每次成功更新 `confirmedAt`：它直接违反 issue 的 writes nothing，业务 revision 不变不能替代零写。
拒绝新增 run observation 列/表：既有 SyncCursor 已表达同步健康；当前无需扩大物理基线、存储映射和迁移测试范围。
拒绝仅 Core API 或把 query 改成 polling：前者按钮不可触发，后者让只读边界暗含摄入。
拒绝持久 begin-generation、跨连接排序和自动轮询：issue 没有这些要求，且每次持久 fence 与严格正常 no-op 冲突。

## Global Constraints

每 PR 代码、测试、配置增删严格 `<800`，文档 `<1300`；预估实现/接线 240–310 行、测试 260–360 行，不填充数字。
未正式发布，不做旧数据兼容、迁移、双写或修复用户数据库；本方案不改 schema 或 Storage port。
保持事务原子性、Provider ack、幂等、失败恢复、Planning 轴正交和凭据边界。
本 PR 独占文件集合：

- `packages/core/src/execution-run.ts`、`packages/core/src/execution-context.ts`、`packages/core/src/context.ts`。
- `packages/controller/src/commands.ts`、`packages/client/src/execution-context.ts`。
- `apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`。
- `packages/ui-model/src/execution-context.ts`、`packages/ui/src/execution-context-section.ts`。
- `tests/integration/execution-run-refresh.test.js`、`tests/integration/execution-context-run-status.test.js`、`tests/integration/harness-plugin-execution-drawer.test.js`。
- `tests/contract/ui-execution-context.test.js`、`tests/contract/harness-host-operations.test.js`，本 ExecPlan。

`host-surface.ts`/`remote.ts` 的 operation 类型由声明派生，默认不修改；`core/index.ts` 已 re-export execution-run，不加重复出口。
与 #367 不共享写区；与 #428 不共享测试或构建脚本。`docs/README.md` 索引由整合 owner 串行更新。
不修改 Issue/Project 的 Status、Iteration、依赖关系，不自行合并 PR。

## Plan of Work

所有下列命令均在检出 `feature/execution-run-refresh` 的工作树根运行；对应目录 `.worktrees/execution-run-refresh`。

### Batch 1 · 签发者、持久健康与无副作用刷新

最小闭环：Core 显式刷新既有 run，读失败与恢复可重开，正常重复完全零写。
主文件：`packages/core/src/execution-run.ts` 与新增 `tests/integration/execution-run-refresh.test.js`。
- 先写 fake/SQLite 两套红测：命令缺失、签发 fallback、状态变更、同状态零写及离线恢复。
- 实现路由、响应身份守卫、run 单飞和事务快照复核；接入 CoreCommands 及不可用组合。
- 新测试覆盖三 StatusPolicy、未知响应、取消交错、事务中途失败和 SQLite 真实重开。
- spy 事务对象全部持久写方法，推进测试 clock 后断言正常重复总写次数为 0，而非仅检查 revision。
验证：`pnpm test:file tests/integration/execution-run-refresh.test.js tests/integration/execution-context-run-status.test.js`。
期望：首次 RED 因缺命令/能力失败；实现后全部通过，原 query 零 Provider 调用断言继续通过。
回滚点：本批提交；撤本批 patch 恢复已有 Start Work/取消行为，保留测试库以诊断失败。

### Batch 2 · 详情按钮到 Host 权威读回

最小闭环：现有按钮触发新命令，DTO 与展示诚实传播状态确认及 stale。
主文件：`apps/harness-plugin/src/host-operations.ts`、`packages/client/src/execution-context.ts`、`packages/ui/src/execution-context-section.ts`。
- 先补 Host → command → getRun → DTO → strict client reader 的红测及 redacted 不调用 Provider 反例。
- 增 typed forwarding、操作声明、Host 前后可见性栅栏及 DTO 白名单；不泄露 providerRef/错误原文。
- 接现有按钮及 ui-model 文案；保持目标切换、断连、迟到成功/拒绝的隔离。
- 跑聚焦回归、类型/边界，再记录真实命令与结果；超预算先收窄接口，不删判别测试。
验证：`pnpm test:file tests/integration/harness-plugin-execution-drawer.test.js tests/contract/ui-execution-context.test.js tests/contract/harness-host-operations.test.js tests/e2e/status-policy.test.js`。
验证：`pnpm run typecheck`、`pnpm run boundaries`；期望均 exit 0。
回滚点：本批提交；撤本批恢复只显示启动时状态的旧按钮能力，Core 批可单独保留供诊断。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 仅问签发者、fallback 不改投默认 | 默认 spy 抛错而 issuing getRun 仅一次；三项 ref 身份差异分别被拒 |
| 状态变更只记录一次、正常重复零写 | 两存储事务 spy；推进 clock 后 run/cursor/账本/revision 总写为 0，确认时间不变 |
| 离线保留最后确认、恢复同状态 | 状态/确认时间不变且 stale；重复失败零写；恢复清 stale 一次，SQLite close/reopen 一致 |
| 未知与坏响应不虚构完成 | 明确 unknown、非 enum、异常及缺签发者均保留 known/显示未知与陈旧 |
| 并发和原子性 | 延迟读与 cancel 确定性交错；cursor 写失败使 run 回滚，重试可恢复 |
| Planning 正交 | 三 StatusPolicy × 四终态；projection/membership/field values/业务 revision 与刷新前一致 |
| 可触发与传输边界 | 真实按钮链、严格白名单、移除任一新增 DTO 字段使测试变红；redacted 前后栅栏 |
| 只读边界 | 初始 reader/query 不问 Provider、不写存储；无轮询与新增取消行为 |

交付前运行 `pnpm verify`；该变化涉及并发与身份，需完整本地回归，不能称为 hosted CI。
提交按两份有意义记录收敛：整合 owner 先提交方案/计划并开 draft；实现者只作一个本地未推送能力提交，独立验收修复收敛入它，最终由整合 owner 补证据/索引后 fast-forward push。
机械交付检查：`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`。
`git diff --check origin/main...HEAD` 应无输出；另核对严格用户规模上限与发布面五类目。
公开 PR 必须 `Closes #365`，以本计划 + Batch、真实证据、风险及回滚描述闭环。
最终 push 后以 `gh pr view -R SingularityKChen/harness-projects feature/execution-run-refresh --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 和 review threads 回读当前结果；满足门禁才 ready，由人类决定合并。

## Progress

- [x] 2026-10-28：独立核对两设计与实际调用边界，收敛语义和最小方案。
- [ ] 2026-10-28：Batch 1 尚未开始，需记录 RED/GREEN 的实际命令与结果。
- [ ] 2026-10-28：Batch 2 尚未开始；无已知外部阻塞，验收不以计划文字代替执行。

## Surprises & Discoveries

- 2026-10-28：runStatus 已存在，但 Host/client 闭集使新增字段不会自动透传；依据见 Context 中实际模块。
- 2026-10-28：取消 CAS 当前只比 status/externalId，不能照抄到刷新；完整身份与本地快照复核是必要修正。
- 2026-10-28：既有 SyncCursor 可持久表达健康度，故推翻“新增 freshness 必须改 SQLite 列”的初始假设；采用 Design 方案。

## Decision Log

- 2026-10-28 / 计划评审者：选择变化式 SyncCursor，避免同语义新表及基线变更；范围见 Global Constraints。
- 2026-10-28 / 计划评审者：确认时间为当前状态的确认下界；freshness 恢复允许一次健康写，常态同值绝对零写，保留原 issue 验收。
- 2026-10-28 / 计划评审者：明确 unknown 不替代已确认 known；它表示未能确认，离线也不把状态改成 unknown。
- 2026-10-28 / 计划评审者：现有按钮形成完整闭环；不把一次人工刷新扩展成自动 poll 或跨进程排序。
- 2026-10-28 / 计划评审者：Status/Iteration/原生依赖不改；用户授权可逆实现与独立 PR，未授权合并。

## Idempotence and Recovery

刷新天然可重复且重新读取 Provider；正常同值没有持久副作用，不缓存成永久幂等命令响应。
失败只改变同步健康度，最后确认状态/ref/时间保持；结构化提交失败不声称已应用，事务完整回滚。
下一次显式成功可恢复；单飞 promise 无论 resolve/reject 均释放，不使 run 永久锁住。
回滚按本 PR 独立提交撤销代码；新增健康 cursor 可保留，不删除用户数据，不实施反向迁移。
若预算或跨进程需求推翻边界，停止扩大产品改动，更新原处取舍与 Decision Log 后重新收敛。

## Interfaces and Dependencies

依赖既有 Node/pnpm/TypeScript、Storage transaction/SyncCursor、ExecutionRunRead 与 Host 远程声明；不新增依赖或凭据。
Actor 只表示发起人；没有外部写入，因此不新增 mutation attempt、ProviderBinding 或发布门禁。
执行前回读当前工作树/分支、远端 head/base/checks；计划基线不是后续易失状态的证明。

## Outcomes & Retrospective

当前产物仅是收敛后的设计与执行计划；产品命令、测试、PR 与运行态验收尚未交付。
技术债务边界：跨进程最新开始序、实时 push、TTL、运行历史不在 #365；有实际需求时另建闭环，不以本计划宣称已解决。
完成时将实际结果、偏差及失败证据写回此节，移入 completed 并由整合 owner 更新索引。

## Bottom Change Note

- 2026-10-28：首次创建；裁决正常 no-op/恢复健康度、未知状态、取消并发和按钮到 Host 的最小闭环。
