# Host 拥有 Planning 定时刷新生命周期 ExecPlan

> 状态：Active；创建：2026-10-22；关联：#335，承接 #134。
> 按 `PLANS.md` 维护；在检出 `feature/host-planning-refresh` 的工作树根目录执行。

## Purpose / Big Picture

Host 启动后，未收到 Provider 事件、客户端只查询时，也能在下一轮定时全量读取看见规划变化和迟到凭据恢复后的实体。
显式 refresh 与定时读取共享 Core 单飞；永不完成的异步读有界退出；卸载先停读与排空，再关闭 SQLite。
最小成功证据是生产 Provider + 录制鉴权 transport + 真实 SQLite 的 Host 集成，以及超时恢复和卸载对抗测试。

## Context and Orientation

`apps/harness-plugin/src/host-composition.ts` 已恢复 Provider、初次 composeCore、创建 Controller，当前没有 reconciler，dispose 同步关库。
`packages/core/src/planning-reconcile.ts` 已实现调度器及 generation 防旧 callback；stop/dispose 不取消在途轮次。
`packages/core/src/context.ts` 的 `refreshInFlight` 才是显式/定时共享槽；必须让它所等待的实际 Provider 读结束，finally 才释放槽。
`packages/core/src/bootstrap.ts` 先消费 reconcile，再读项目与列表，最后事务提交；读失败沿既有路径保留 last-known 并标记 stale。
`apps/harness-plugin/src/host.ts` 凭据每次经 ctx.get 读取，服务可晚出现；当前只证明 bootstrap 命令恢复，未证明 query-only 恢复。
`remote.ts` 已排空远程调用与 watch，但不知道后台轮次；Host 必须额外拥有后台资源收尾。
依据为 issue #335 全部验收与两条评论、`docs/architecture/release-gates.md`、已完成 Core refresh 计划。

## Design / Spec

新增窄 Host Planning lifetime helper，在 restoreProviders 之后、composeCore 之前替换真实 Planning 端口。
生产 GitHub entry.create 只构造对象，不读凭据或网络；但 describeCapabilities 内调用闭包中的 getProject 并发请求，因此必须单独包装 describeCapabilities。
显式列出七个读边界：describeCapabilities、getProject、getPlanningItem、listPlanningItems、listFieldDefinitions、listIterations，以及可选 reconcile。
Promise 读用默认 30 秒预算；超时用固定安全错误拒绝 Core 正在 await 的端口 Promise，清 timer/listener，消费晚 resolve/reject，不接受晚值。
保留 definition、方法 this、可选方法缺席形状；写方法透传，生命周期不调用 Provider 写方法，不对写结果套 timeout。
reconcile 用包装 AsyncIterator：从该迭代开始设不续期的绝对 30 秒预算，next 使用剩余预算，防持续 yield 永不退出。
迭代失效后不再调用底层 next；return 只 best effort，消费拒绝并立即返回本地 done，不能让 IteratorClose 等待卡住的底层 return。
生命周期 stop 关闭新读准入；已开始的 await 可在预算内收尾。超时并不声称硬杀任意 Promise；废弃底层值不能回到 Core commit。
restoreProviders 注入的 credential 在解析前后检查 lifetime、fetch 开始检查 lifetime，避免迟到凭据在 stop 后启动请求；不重写 transport/Response 或引入通用取消框架。
能力探测超时可导致 compose 失败，诚实释放 SQLite；凭据暂不可用的结构化结果仍可正常完成降级组合并由后续 tick 恢复。
Host interval 默认和下限均为 60000ms，上限 2147483647ms，finite 校验；测试注入原调度器 timers 并手动 tick，不降低生产速率下限。
ready 后有效 Planning 槽仅 start 一个 reconciler；空工作区、缺失或禁用 Planning 不建 timer，不紧接初次 bootstrap 再读一轮。
同一个 diagnostics 对象交给 composeCore 与 createPlanningReconciler，复用既有脱敏 sink；不实施 #336 的 absorber 重构。
`OPERATIONS` 加 unary refreshPlanning，只传既有 actorRef codec，无 idempotencyKey；handler 转 Controller refreshPlanning，scheduler 调 Core refreshPlanning。
Host 只登记在途任务用于 drain，不新增业务单飞缓存。定时与 remote 并发均由 Core 槽合并，下一次 refresh 必须真实重读而非 replay。
卸载协议：composition.stop 同步关准入并 dispose timer → await remote.dispose 排空显式调用/watch → await composition.dispose 排空已登记后台/直接调用 → close 一次。
dispose 缓存同一 Promise；stop 后旧 callback、保留 call/watch 不得新读；调用注册失败和 effect 注册失败也沿同一资源清理路径。
不选 race 整轮 Core refresh：内部槽和提交仍存活；不选仅 fetch signal：credential/json/iterator 不受保证；不改 Core scheduler 或 Provider catalog。

## Global Constraints

文件集合：新增 `apps/harness-plugin/src/host-planning-lifetime.ts`，修改 `host-composition.ts`、`host.ts`、`host-operations.ts`（均位于同一 src 目录）。
测试集合：新增 `tests/integration/harness-plugin-host-planning-refresh.test.js`，修改已有 Host runtime/watch/provider/artifact 集成及 Host operations/remote 契约中必要的声明、夹具与 await dispose。
文档集合：本计划与 `docs/README.md`；确有新债时才更新 `docs/exec-plan/tech-debt-tracker.md`。
代码+测试 additions/deletions ≤800，文档 ≤1300；目标约650–750行，复用 host-seed，避免逐场景复制大夹具。
不改 `host-providers.ts`（PR #388 owner）、Core refresh/scheduler、schema、renderer、UI、webhook、游标或 watch 通用协议。
不依赖 #336；#282 的 getExecutionContext 是 parent 顺序整合的独立 additive registry 变更，不在本实现中改写。
不写 Provider、不保存 token、不改 Planning/Engineering 权威边界与看板 Status/依赖关系；无真实外部写入。
所有日志只保留现有 name/code/errcode 白名单；不记录 message、token、路径或原始网络错误。

## Plan of Work

### Batch 1 · 读等待与迭代生命周期

主文件为新增 Host helper。先写挂住 list、credential/fetch/json 及 iterator next/return 的失败用例，再接入 compose 前真实 Planning 端口。
验证超时后 Core 槽释放、第二轮恢复、旧请求晚成功或晚拒绝不覆盖新投影/revision，且无未处理拒绝。验证 describe 探测也受界限。
回滚点为本批 helper 与接入；本批不单独交付 PR，未完成 Host lifecycle 不 ready。

### Batch 2 · 定时/显式入口与卸载闭环

主文件为 composition、host entry 与 operations。共享 diagnostics、start reconciler、加 actor-only refresh、登记在途与异步 dispose。
从真实 applyHost 入口证明缺凭据组合后服务出现，客户端不发命令，下次定时轮自动恢复；另证无事件字段变化到 baseline/已有 watch。
卸载覆盖 scheduled/explicit/watch 在途、双卸载、旧 callback、保留 service 与注册失败，所有资源清理早于 SQLite 最终关闭。
回滚点是完整任务提交；全部验收一起组成一个可独立合并、撤销的 PR。

在计划指定检出根目录运行（新测试文件在 Batch 1 建立）：

    node --test --test-timeout=120000 tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-watch.test.js
    node --test --test-timeout=120000 tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-artifact.test.js
    pnpm run typecheck
    pnpm run boundaries
    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

预期所有命令 exit 0；新测试须先证明关键用例在接线前失败，既有 fixture 及冷启动行为保持。
最终 push 后用 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefOid,closingIssuesReferences` 与 `gh pr checks -R SingularityKChen/harness-projects` 锁当前分支 PR，回读当前 head checks、issue 双向关联和所有 review threads。
当前 head release gates、产物与独立验收成立才 ready；保持 open/unmerged，改 head 后重新取证。

## Validation and Acceptance

| 场景 | 判别证据 |
|---|---|
| 无事件变化 | 生产 catalog、鉴权回放、SQLite；改 Provider 字段/新增条目，不发事件不发命令，tick 后 baseline/已有 watch 可见 |
| 凭据晚出现 | apply 时 ctx.get 无服务，baseline degraded/空；服务出现后只查询，下一 tick 得 fresh 实体与新 canary 鉴权 |
| shared flight | 真实 list 读挂住时多 tick+多 remote refresh，仅一轮全读；结束后下一 explicit 真读，不 replay |
| timeout / late result | 分别卡住 credential、fetch、json、list、next/return；预算内退出并 stale，后轮成功；晚值/晚拒绝无回退和未处理拒绝 |
| iterator 绝对预算 | 持续非终止 yield 也到期，return 卡住不阻塞 Core 退出；不只测创建 generator |
| offline / recovery | 已有 rows 与确认时刻保留，失败 stale，后续成功 fresh；全部场景 Provider 写调用为零 |
| lifecycle | ready 后一 timer，空/无效挂载零 timer；stop 后旧 callback/保留调用零新读；排空后 close 恰一次，重复卸载同结果 |
| startup / failure | describe 探测卡住有界失败并清资源；remote/effect 注册失败也停止 timer 并关库 |
| diagnostics | scheduled fault 进入同一实际 log，安全字段可见、token/path/message 不见，后续 tick 继续 |
| integration boundary | operations 参数/descriptor/client 派生正确，包边界、artifact、typecheck、完整 verify 与当前 head gates 绿 |

测试使用真实 createHostComposition/Core/SQLite/installHostRemote；不得 mock 整轮 refresh 立即返回来证明读有界。
现有 watch 仅作查询消费者，不增加 streaming 功能。真实 Desktop 安装认证未实测时明确证据止于 Host fixture 与构建产物。

## Progress

- [x] (2026-10-22 SGT) 独立审查设计 A/B、issue 验收与评论，以及 Host/Core/Provider 调用链。
- [x] (2026-10-22 SGT) 核实生产构造无请求、describeCapabilities 有探测；计划覆盖首轮组合前读等待。
- [x] (2026-10-22 SGT) Batch 1：先观察 scheduler 缺失、list/iterator 永久等待的失败，再实现端口预算；晚成功、晚异常、持续 yield、挂起 return 与后轮恢复通过。
- [x] (2026-10-22 SGT) Batch 2：真实 applyHost + 生产 GitHub Provider + SQLite 证明 query-only 晚凭据与无事件变更，显式/定时共享 Core 槽；stop、remote/background drain、重复 close、注册失败通过。
- [ ] 独立验收、产物与当前 head gates、提交清理、ready 回读。

## Surprises & Discoveries

观察（2026-10-22，`main@d7e7bca6`）：GitHub Provider describeCapabilities 会 await 闭包 provider.getProject；包装外部 getProject 不会拦截该内部调用。
证据：`packages/providers/planning-github-projects/src/provider.ts` 的 describeCapabilities 与 `apps/harness-plugin/src/host-providers.ts` 的 GITHUB_PROJECTS_ENTRY.create。
现有 fetch 30秒 signal 在凭据之后建立，不能单独释放 Core await；原 remote drain 不包含 scheduled 任务，必须增加 Host 资源所有权。
首次全仓验证发现新 helper 的 type-only capabilities import 也受应用包边界限制，导致两个边界相关测试失败；helper 改成零 import 的类型保持包装后重跑通过，不扩大 Host 例外或依赖图。
旧 runtime 卸载夹具在读尚未进入 transport 时即 stop，新准入 fence 正确让该轮提前失败；夹具改为先等待 transport 已进入，再验证 drain 期间不能 close。
暂缺凭据 reason 仍可能表现 not_found，属于既有 TD-056；本任务兑现自动恢复，不宣称修复所有凭据分类文案。

## Decision Log

- Decision：端口读 Promise 及 iterator lifetime 是唯一 timeout 传播边界。Rationale：直接结束 Core 的 await，晚值没有 Storage 权限，不引入整轮假取消。Date/Author：2026-10-22 SGT / 独立设计审查。
- Decision：stop 关新读、既有轮次在预算内收尾、drain 后 close。Rationale：保持已有 Core 事务与远程排空契约，避免关库后提交。Date/Author：2026-10-22 SGT / 独立设计审查。
- Decision：只加 credential/fetch 的 lifetime 准入检查，不造通用 transport 框架。Rationale：避免 stop 后晚凭据发新请求，同时不改写 Provider 写确认语义。Date/Author：2026-10-22 SGT / 独立设计审查。
- Decision：Host interval 默认/下限60秒，read30秒；复用 Core timers 注入。Rationale：全量读取有分页成本，测试与生产速率预算分开。Date/Author：2026-10-22 SGT / 独立设计审查。

## Idempotence and Recovery

start/stop/dispose 按资源所有权幂等；dispose 的调用者共享相同 Promise。读计时器、监听器每种完成路径清理，底层晚拒绝被消费。
定时 refresh 可重复，Core 槽与 round fence 保留；不引入 replay key。失败恢复先修实际等待边界，不用关闭超时强行提前关 SQLite。
按任务提交整体回滚，无 schema/data 迁移；保留其它 worktree 改动。最终 push 改 head 后重锁 CI/评审事实。

## Interfaces and Dependencies

依赖既有 createPlanningReconciler、PlanningReconcilerTimers、Controller refreshPlanning、Node timers/AsyncIterator 与 SQLite；无需新第三方依赖。
Host options 提供 interval、readTimeout、timers 测试入口，生产使用上述预算；HostComposition 增加同步 stop 与异步 dispose。
OPERATIONS 复用 actorRef Param，只加 refreshPlanning；HOST/CLIENT descriptor 从唯一声明派生，client 不引入 Node/Core/Provider。
本地鉴权为录制 canary；真实凭据仅经 Host 句柄解析，测试报告不得当成真实 Desktop 成功认证。

## Outcomes & Retrospective

在 `feature/host-planning-refresh` 检出根目录验证：目标命令（本计划 Batch 1/2 所列八个测试文件）75 项通过；`pnpm verify` 的 typecheck、1771 项 contract/integration/e2e 与 7 项 mvp0 全部通过；`pnpm run boundaries` 9 项、workflow-check 8 个文件通过。
三条 RED 证据在实现前实际观察：scheduler 期望 1 个 timer 实为 0；list 与 iterator next 在 500ms 安全外层时限内仍未完成。GREEN 的实际 Core 端口等待已改成默认 30 秒预算，测试配置 100ms；不是整轮 race。
测试确认最后已知内容、SQLite `reconcile_cursor` 确认时刻与修订号在失败时保留，恢复轮推进；晚值和晚异常均不覆盖恢复结果。Provider 写调用为零，凭据 canary 在 query-only 后续 tick 轮换，全部录制请求命中。
本地实现与产物证据已成立；独立验收、最终 push 与当前远端 head gates 由交付者继续，不在本批执行外部写入。按本次交付要求保留 active，不关闭 issue，不宣称真实 Desktop 安装认证成立。
不新增有意延期技术债；TD-056 的既有 reason 歧义保留。实现发现新的必要延期时记入既有 tracker，不能用延期删除本 issue 验收。
全部验收完成后如实记录结果与偏差并移入 completed、更新索引；未合并状态由最终远端回读报告。

## Bottom Change Note

2026-10-22 SGT：融合两份独立设计，选择最小端口等待边界、iterator绝对预算与两阶段卸载，显式核实首轮能力探测并排除 #336/#388 扩张。

2026-10-22 SGT：记录实际 RED/GREEN、全仓 1771+7 测试与边界修正；保留 active 等待独立验收及远端当前 head 回读。
