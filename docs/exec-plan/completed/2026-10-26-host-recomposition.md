# 提交设置后即时重组 Harness Host ExecPlan

> 状态：Completed · MMP 意见修复与独立复评通过，等待最终远端回读与授权合并
> 创建：2026-10-26
> 范围：issue #354；单工作区设置 remote、串行装配替换、同一 watch 连续交付与 TD-081 延迟探测。
> 上游输入：issue #354、`docs/adr/ADR-0013-harness-host-composition.md`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`；按根 `PLANS.md` 维护。

## Purpose / Big Picture

用户在插件内创建工作区、连接规划项目或绑定仓库后，Host 立即使用已提交配置；不重启、不重新打开 watch。失败时仍能读取旧装配，并明确分开“本地配置已提交”与“装配未激活”。多个缓慢 GitHub Development 权限探测不能串行阻塞 Host ready、替换或卸载。

最小证明是空 SQLite→同一 remote 创建/绑定→原 watch 的客户端读数等于新 baseline；旧 reconciler 恰好释放一次，替换中卸载先撤 remote、排空已有工作再关 SQLite。

## Context and Orientation

设置写者已在 `packages/core/src/workspace-setup.ts`，`createSetupCommands()` 已有完整请求指纹与 replay，注释要求每进程持有一次、跨重组不丢。现有 Host 只启动时 restore/compose 一次，空工作区永远 unavailableCore；`OPERATIONS` 尚未暴露设置命令。

`composeCore()` 会登记配置并执行首轮规划水合，绝非纯构造。旧代规划任务与新候选同时写同一 SQLite 会造成竞态。`PlanningReconciler.stop()` 可暂停后 start，dispose 则不可逆；read lifetime 有有界等待但 stop 不会取消已借出的 Core 工作，必须真实 drain。

2026-10-26 在 `origin/main@d470308` 观察并做内存 spike：`streamWorkspace` 对同修订 header 变化发 metadata，对 revision 前进发 delta，对同 revision 实体业务变化发 gap；`followWorkspace` 拒绝同一物理代第二 baseline。单纯动态委托只在替换后改 generation，不能阻止候选水合期间旧 views 配新 revision。

本 PR 在分支 `feature/host-recomposition`、工作树 `.worktrees/host-recomposition` 根执行，基于 #277 分支；父 PR 合并后重定位 main。先回读 `git rev-parse HEAD`、`git status --short --branch`。协调者的 1927+7 通过仅是 d470308 基线，不是替换完成证据。

## Design / Spec

方案 A：Host 持有稳定服务、SQLite、设置账本和 watch source，可替换的装配只含 Core/Controller/reconciler/read lifetime/disabled。方案 B：Core registry/context 原地可变。选择 A：宿主生命周期留在 apps，避免半更新 registry。方案 C 重启 remote 并靠客户端重连违反同一 stream 验收，舍弃。

不建通用 holder framework、event bus 或 provider manager。沿现有 `createHostComposition` 使用一个 current 指针、一个配置 tail、一个 transition promise/epoch 和短调用集合；`controller/disabled/activationError` 使用 getter。`assemble(workspace)` 仍是本 Host 的局部函数；#277 的 helper 在这里调用。

SQLite、`createSetupCommands(createWorkspaceSetup(storage))`、remote 与 `streamWorkspace(stableSource)` 每 Host 只建一次。每次普通 unary 捕获一个 current 装配并登记短调用租约；长期 watch iterator 与等待节拍不算装配租约。scheduler refresh 同样登记，不能只追 remote call。

配置序列必须是：进入唯一 tail→递增内部 epoch 并设读取屏障→暂停旧 reconciler.stop→排空旧短调用/已开始规划轮→执行设置命令→读已提交配置并比较 active fingerprint→需要时 assemble→确认未 closed 后交换 current→旧 lifetime.stop/reconciler.dispose 恰好一次→启动新 scheduler→释放屏障。失败恢复旧 scheduler.start；候选资源释放，不能关共享 Storage。 Superseded by D4（2026-10-26）。

D4 的当前序列：进入 tail→epoch/屏障阻止新短调用和 tick 借用→drain 已开始轮次→执行设置并比较 fingerprint；变化才 stop 旧 scheduler、assemble 并 publish/retire，否则保留原 timer 身份。屏障等待者不持租约；醒来再次检查屏障，旧代 tick 再核对 lifetime 后才能借用，所以旧 callback 不能在新代发布后写库。失败仅在确实 stop 后恢复调度。

屏障在配置提交之前建立。stableSource.baseline 在屏障外等待，借 current 读取后再核对 epoch/current；变化则丢弃旧结果、等屏障后重读。只有实际 controller.baseline 调用持租约；等待屏障的 baseline 不持租约，tail 也不能等待自己，否则会死锁。remote baseline 与 watch 都走此读面。

所有候选参数和资源先校验，首轮水合后只允许无失败点的指针发布；不能把有副作用 compose 包装成可随意取消的纯构造。已有旧规划轮 drain 后才水合候选，消除旧代晚写。候选失败保持旧装配服务，本地已提交设置保留，不能声称事务回滚。

同一 stream 一生只送一次开场 baseline。create 的 r0 descriptor 改变沿 metadata，bind 后 bootstrap 前进修订沿 delta，最终 store 与独立 baseline 一致。内部 epoch 只做读取栅栏，不写 wire generation、不改 follower/stream 协议。若测试仍出现 gap，修业务提交/读取顺序，不放宽协议掩盖。

remote 在 `OPERATIONS` 唯一声明四个精确位置参数：`createWorkspace(actorRef,idempotencyKey,name)`；`connectAccount(actorRef,idempotencyKey)`；`bindPlanningSource(actorRef,idempotencyKey,accountId,projectNodeId)`；`bindRepository(actorRef,idempotencyKey,repositoryId,references)`。闭集解析先于 handler；客户端不传 workspaceId、statusPolicy、secretHandle。Host 补固定 scope、ProviderAuthoritative、GitHub origin 与 planning implementationKey；repository references 沿已有 #353 类型与目录 schema 校验。

connectAccount 在 Host 用固定句柄和共享有界 GitHub transport 只读 `GET /user`，只取真实 `node_id/login`，再调用既有 createSetupCommands.connectAccount，identityKind=account。未取到有效身份零本地账号写入；同键重试若凭据已换另一账号，由完整请求指纹冲突拒绝，不把 project ID 或任意常量充当账号 ID。401/403/404/限流/解析失败返回现有结构化码和固定文案，#278 的额外三路诊断不在此猜测。

四操作正常返回既有 `CommandResult<T>={writeState,saving,authoritative,value,error}`；成功 value 分别为 `{workspaceId}`、`{accountId}`、`{bindingId}`、既有 RepositoryBinding。增加可选 `activationError:ProjectError` 仅表示配置已提交而激活失败。Gateway 自己的 `{ok,value|error}` 是外层信封，客户端必须先解包，不能混为 command result。

组装失败返回原 `local_only` 与 command value、固定安全 unavailable activationError；不能换成 failed 暗示未落库。同键重发先重放原设置结果，再比较 desired/active fingerprint，仍未激活就再次 assemble。相同配置且已激活则零组装/零 scheduler restart。connectAccount 创建尚未挂载账号不触发装配。#131 再加独立 getWorkspaceSetup/read viewer，不在本 PR 冒充 UI 交付。

TD-081 选择最小 lazy 模式：GitHub Development Provider 增 `permissionMode?: eager|lazy`，默认 eager 保持原合同；Host 选 lazy，describeCapabilities 只返回本实例最近真实 getRepository 结果，初值 degraded/未验证，绝不 fabricated available。真实 getRepository 成败更新 snapshot/observedAt；无新观测就保留原确认时间，不刷新为“刚确认”。不另建后台 probe/scheduler。

Host 仅对此类 Development 实例按 binding+implementation+规范配置+account identity/secret handle 复用，值不入键；同配置替换保留真实确认快照，换目标创建新实例并降 degraded。cache 为 Host 生命周期内存，候选成功后清理不再使用的条目，不能持久化成永久授权。registry 下一次组装取最新确认快照；本 PR 不承诺自动权限刷新 UI。

卸载首先 closed/关闭新准入、停所有 scheduler，并让本 Host 的 watch 取消信号结束等待；Host 入口保持 remote withdraw/drain→composition drain→SQLite close。配置 tail、实际 baseline、规划轮均计入总 drain，停止后候选不得 publish/start timer。dispose 幂等共享 Promise；底层不合作 Promise 的等待仍受现有 read deadline 约束，晚拒绝被消费。

外部记录：设置只写本地配置，actor 来自信封，target 为对应 workspace/ProviderBinding，幂等键与 fingerprint、提交结果、activationError 分别记入脱敏证据；规划 Provider 读 ack 不改成本地 Saved，工程事件不写 Status。官方 HTTP 已读 `https://www.sqlite.org/lang_transaction.html` 与 `https://deepseek-harness.github.io/deepseek-harness/develop/basic/`：事务不能代替应用层装配切换，ctx.effect 管卸载资源；具体策略以此处实测反例和仓库生命周期为依据。

## Global Constraints

代码加测试严格小于 800 行，文档严格小于 1300 行，包含删除/移动行。目标 composition/operations 约 250、lazy/cache 约 60、测试约 330，总约 640，预留 150；复用现有 seed、carrier、lifetime 和 scheduler，不搬移整个 composition 制造双倍 diff。

唯一文件集合：`apps/harness-plugin/src/host-composition.ts`、`host-operations.ts`、`host-providers.ts`、`host.ts`、`host-surface.ts`；`packages/providers/development-github/src/provider.ts`；`tests/integration/harness-plugin-host-recomposition.test.js`（新增）、`harness-plugin-host-github-catalog.test.js`、`harness-plugin-host-watch.test.js`、`harness-plugin-host-runtime-adapter.test.js`；`tests/contract/harness-host-remote-adapter.test.js`、`tests/contract/harness-host-operations.test.js`、`development-github-contract.test.js`；本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`、`docs/review/pr-403-mmp-review.md`。现有自动派生类型足够时不改 host-surface/host.ts。

同一 Host owner 在 #277 之后修改此集合，#131 的 Host 接线也由这个 owner 顺序集成。UI/client 设置主体可并行，#140 完全独立。不改 core mutable registry、client/watch wire、Status 或 blocked-by/blocking，不新造第五个“只为凑预算”的 PR。

## Plan of Work

### Batch 1 · 设置 wire 与可重试激活

**最小闭环**：空 SQLite 经真实 remote 创建、连接账号、绑定 planning/repository，设置账本跨替换存活。
**涉及文件**：`apps/harness-plugin/src/host-operations.ts`、`host-composition.ts`、`tests/contract/harness-host-operations.test.js`。
先 RED：陌生字段/错误 scope 零 setup；同键异完整请求 conflict；双提交恰一记录；配置 commit 后 assembly 失败返回 local_only+value+activationError，同键重试能成功激活；配置未变零重复重组；viewer 身份只取成功响应 node_id/login、缺凭据/畸形响应零账号写入、换账号同键 conflict。实现唯一 setup instance、tail、局部 assemble 与结果增强至 GREEN。

    pnpm run test:file tests/contract/harness-host-operations.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/workspace-setup-commands.test.js
    pnpm run typecheck

期望新案例先因缺操作/固定装配失败，再全部 pass。失败回滚本批 wire/holder，已落配置保留，原 Host 重启可恢复；不删账号、绑定或库。

### Batch 2 · 同流读取屏障与卸载

**最小闭环**：替换中没有混合 revision/views，原客户端同一物理 open 抵达新基线。
**涉及文件**：`apps/harness-plugin/src/host-composition.ts`、`tests/integration/harness-plugin-host-recomposition.test.js`、`harness-plugin-host-watch.test.js`。
RED 用手动 barrier 暂停旧 baseline 在 listPlanningItems 后、workspaceRevision 前；此时提交设置/水合候选，恢复读后断言丢弃旧结果，无 gap、无第二 baseline、open 次数 1。再测旧 refresh 延迟提交、连续两次配置、候选失败恢复旧读、replacement+unload、stop/dispose 重复与 close 后零存储访问。不能只测空列表 happy path。

    pnpm run test:file tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js

期望每一旧 reconciler dispose 恰一次，失败候选不启动 timer；remote 已撤再 close，in-flight 真正结束。回滚屏障和替换主体恢复启动装配，不修改 stream 协议作补偿。

### Batch 3 · 慢 Development 绑定与交付

**最小闭环**：两个 repository probe 永不 settle，Host ready/替换仍可完成且能力诚实。
**涉及文件**：`packages/providers/development-github/src/provider.ts`、`apps/harness-plugin/src/host-providers.ts`、`tests/integration/harness-plugin-host-github-catalog.test.js`。
先 RED：两个慢绑定的构造/替换发起零 probe、初始 degraded；真实读成功后同配置替换保留旧 observedAt/permission；换配置/账号不沿用；失败真实读降 degraded；卸载/替换时迟到调用不能污染新实例。实现显式 lazy 模式及窄 cache，默认 eager 的原套件保持。

    pnpm run test:file tests/integration/harness-plugin-host-github-catalog.test.js tests/contract/development-github-contract.test.js tests/integration/harness-plugin-host-recomposition.test.js
    pnpm run boundaries
    pnpm verify
    git diff --check

期望命令 exit 0；最终完整回归仅在本 PR 最终 head 跑，有新失败再重跑。若预算超限，先删重复清理/分发和非必要通用抽象，不能削 TD-081 或竞态验收；仍超则修订范围并报告，不以未完成关闭 issue。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 不重启的 create/bind 后 baseline 可用 | Batch 1 真实 SQLite/remote 集成 |
| 新 binding 重新调度、旧资源仅释放一次 | Batch 2 scheduler 身份与调用数 |
| 原 watch 连续到新 baseline | Batch 2 完整 client follower/store 对照，open=1、无 gap |
| assembly 失败保留旧服务且可同键激活 | Batch 1/2 的 persisted/active 分离反例 |
| 卸载先 withdraw/drain 后 close | Batch 2 replacement/旧读/卸载三向竞态 |
| TD-081 不阻塞且不伪造权限 | Batch 3 两个永挂 probe、确认快照及换目标反例 |

本 PR 以 #277 为真实 base。提交前运行 `node scripts/rule-checks.mjs disclosure feature/planning-field-mapping`、`node scripts/rule-checks.mjs size feature/planning-field-mapping`，另核对本轮 <800/<1300；父层合并后改用 origin/main。最终 push 用 `gh pr view -R SingularityKChen/harness-projects <实际PR号>`、`gh pr checks -R SingularityKChen/harness-projects <实际PR号>` 回读当前 head/base、所有 checks/threads 和 issue 关联。

GitHub 官方 linking 文档明确非默认 base 的 closing keyword 不创建 issue link，因此描述写 Closes #354 后还须回读 closingIssuesReferences 与 issue 的 Development 侧栏；缺失时由已获授权的执行者通过侧栏手动链接并双向回读，不为关键词把真正依赖改成 main。该外部记录写明 actor、repo/PR/issue 目标、幂等身份 PR+issue、链接结果及回读；不改 Status/依赖关系。通过当前 head 证据后才 ready，人类决定合并。

## Progress

- [x] 2026-10-26 MMP：新增并发设置永久回归，原串行 tail 变异由 SURVIVED 转为指定新用例 KILLED；独立复评九文件 135/135、最终 5/5 变异通过且字节还原，无新增发现。生产实现不变。

- [x] (2026-10-26 16:38 +08) 独立核对两份设计、stream spike、reconciler stop/start 与 compose 副作用；完成此 spec，文件集合见 Global Constraints。
- [x] (2026-10-26) Batch 1：真实 remote 新操作 RED 3 fail（缺方法/未声明操作），实现后 3/3；覆盖闭集、viewer 身份失败零账号、同键换账号 conflict、local_only+activationError 与重试。
- [x] (2026-10-26) Batch 2：原 follower 在同一物理流接收 baseline→metadata→delta；旧 baseline、旧轮 drain、barrier 中 tick 不持租约、失败保留非空旧服务、stop/remote drain/close 路径已进入窄回归。
- [x] (2026-10-26) Batch 3 实现：lazy RED 为 describe 错报 available/发生 probe；修复后 provider 默认 eager 合同保留，两个慢绑定零启动探针、真实确认时间复用、换配置/账号句柄与晚读隔离已验证。
- [x] (2026-10-26) 最终九文件窄回归 133/133，原 boundaries 9/9；`pnpm verify` 的 typecheck、完整 1954/1954 与 MVP 7/7 通过。
- [x] (2026-10-26 @ 7687e364) 首轮独立系统验收 PASS、0 P0/P1；7 项额外反例、8/8 关键变异被杀死。
- [x] (2026-10-26) 修复波次落实 F1–F3：永久 SQLite 晚写断言、直接 unary 同 Promise 二次读取、死装置与注释清理；隔离副本删除 lifetime assert/fence 分别触发指定断言 RED，2/2 KILLED，原树哈希及副本还原均无差异。
- [x] (2026-10-26 @ 7687e364 + 本地修复) 最终九文件窄回归 134/134、typecheck exit 0、原 boundaries 9/9；`pnpm verify` 完整 1955/1955、MVP 7/7，空白检查通过。
- [x] (2026-10-26) 独立 scoped 复评 PASS，F1–F3 全部关闭；134 项定向、9 项边界、typecheck 与 2/2 永久测试变异通过。归档计划并按对应范围维护债务；最终 push 后以当前 head 回读命令判定 Ready，人类决定是否合并。

## Surprises & Discoveries

baseline source 动态委托是必要条件，单独使用仍不足：controller.snapshot 分开读取 views/revision，而候选 compose 会写共享 SQLite。屏障必须早于 setup commit，读后 epoch 检查必须覆盖跨 transition 的读；等待屏障的流不能被 tail 当成待排空短任务。

scheduler 已有可逆 stop/start，不必为了失败恢复创建第二套调度器。Development 的默认 describe 每次真实 probe，Promise.all 仍会等待最慢项；明确 lazy 模式才能离开关键路径。

初轮目录回归揭示旧“启动探针+两次读取”计数与新 lazy 策略冲突：保留真实读取的 deadline/错误分类，启动计数改为零。fingerprint 不能读取目录未知实现的配置，否则原有“禁用挂载且保留库行”会变成启动失败；当前按真实 catalog 跳过其配置，挂载身份仍进入 fingerprint。

候选 scheduler 资源分配必须早于 current 发布：单点 timer throw 的新增反例先因旧 Controller 已被替换而 RED；当前先创建候选 timer，失败 retire candidate、保留 old，不把已提交设置改报 failed。

首次完整回归为 1952 pass / 1 fail，唯一失败是 remote-adapter 的精确操作清单遗漏新增四操作；已按 Global Constraints 扩入该库存测试，补操作名与参数数目，不放宽断言。仓库绑定后 Core 会把单 Development 的 `isDefault` 改为 true；若 fingerprint 含该派生标志，同键重放会无故重组。新反例先因 Controller 引用改变失败；当前 fingerprint 只取 Host 实际消费的 id/domain/implementationKey/enabled、配置和账号，排除 Core 派生的 isDefault。

独立验收指出：旧 tick 的 Provider 读数为 0 不能证明旧 Core 未写入 SQLite；原 watch 最终追平也不能单独证明同一旧 baseline Promise 触发重读。本轮分别增加发布后 `putPlanningSyncRound` 的 0 次断言、直接 unary 的 2 次实际 SQLite 读断言；两个回退变异在隔离副本中被对应永久用例杀死，产品生命周期逻辑未变。

## Decision Log

- 2026-10-26：人类本会话明确要求无 P0/P1 时由评审方负责修复、独立复评、归档与 rebase 合并 PR #401–#404。原实现会话当前 idle，评审方接手这四个分支的本次非阻塞收尾；不据此改规划 Status 或依赖关系。


D1 · 2026-10-26 16:38 +08 / 独立计划评审者：稳定 source+提交前屏障+读后 fence，保持原单 baseline 协议。Rationale：源码/spike 支持 header metadata 与 revision delta，实证覆盖 views/revision 混读。

D2 · 同时 / 独立计划评审者：失败保留 local_only 与 activationError，同键仍执行激活检查；暂停/排空后再 assemble。Rationale：配置事务已提交，replay 与激活不是同一事实。

D3 · 同时 / 独立计划评审者：选 provider lazy/on-read 和同配置实例复用，不加后台 probe lane。Rationale：满足 TD-081 的最小路径，保持真实确认时间，避免额外 scheduler/重组循环与预算膨胀。

D4 · 2026-10-26 / 实现 owner、协调者确认：用提交前屏障暂停新借用，只有 fingerprint 变化才 stop/start scheduler。Rationale：真实重复绑定测试证明无变化时 stop/start 会更换 callback，违背零 restart；新 tick 等待屏障不进入 drain，旧 lifetime 在醒来后复验，不能晚写旧 Core。

D5 · 2026-10-26 / 协调者、实现 owner：采纳独立验收 F1–F3，在同一测试夹具内补真实写入/重读判别并删除死装置，仅校正两处注释。Rationale：把独立证明永久化，避免 Provider guard 或后续 poll 掩盖回退；不改变正确的产品生命周期。

## Idempotence and Recovery

设置命令用同一进程账本及数据库自然键；重放不重复本地创建，激活失败可重试。屏障/tail 在 finally 释放，拒绝不能让所有后续调用永挂。替换失败恢复旧 scheduler，closed 时不能恢复；卸载幂等、共享 Storage 只关一次。

回滚 PR 恢复启动时装配，配置/映射留在库中供重启使用，不清理用户目录。本计划已通过：TD-081 的启动探针剩余范围已解决，TD-055 只标重组部分已解决而保留多工作区、disabled 投影与 schema 边界；TD-058 保持既有 Resolved；新遗留进入 `docs/exec-plan/tech-debt-tracker.md`，不能用旧 transport deadline 代替延迟验收。

## Interfaces and Dependencies

依赖已落地 #127/#353 的设置命令与 #277 helper；最少栈 #277→#354→#131，#140 独立。Host 内部 Assembly 没有新公共 Core 接口；外部新增四个设置操作及可选 activationError。#131 的 getWorkspaceSetup 读取配置与活动装配分别判断，不要求当前 workspace baseline 已存在。

GitHub GET /user 身份合同已于 2026-10-26 HTTP 读回官方 `https://docs.github.com/en/rest/users/users#get-the-authenticated-user`，响应含 login/id/node_id；此处只保留两个必要字段，不回显原响应。官方链接行为已读来源：`https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue`。SDK/运行版漂移不在本 PR 改 peer 范围，测试替身不能冒充真实 Harness 安装证据。

## Outcomes & Retrospective

实现及 F1–F3 测试修复波次完成，最终九文件窄回归 134/134、原 boundaries 9/9 通过；`pnpm verify` 为 typecheck 通过、完整 1955/1955、MVP 7/7。独立候选验收 PASS 的 7 项额外反例和 8/8 变异证据保留；本轮只加强永久测试和清理，新增两项副本变异 2/2 被对应永久用例杀死。首轮 full 的唯一旧操作库存失败已修复；仓库重放与 timer 分配反例均已 RED→GREEN。`git diff --check`、相对父层的空白检查与原边界文件逐字比较 exit 0。disclosure/size 脚本对已提交计划通过，未提交实现与新增测试另作人工五类扫描；唯一路径模式命中为官方 GitHub 文档 `/users/`，不是本机身份。协调者提交后须重跑包含实现的机械扫描。执行上下文为 `.worktrees/host-recomposition`，父层为 `feature/planning-field-mapping`，起点 `0266a5c`。上述作者记录时尚未提交或 push 修复；现独立 scoped 复评已 PASS，F1–F3 关闭并完成归档。外部发布按当前 head 回读命令验收，不以本文冻结易失 checks 值。

## Bottom Change Note

2026-10-26 16:38 +08：创建并修订双方案，补提交前读屏障、短租约 drain、失败激活重试和窄 lazy 权限模式，禁止协议放宽及机械聚合。

2026-10-26：记录设置 wire 与 lazy 模式 RED→GREEN、同流 follower/旧轮与晚 tick/替换失败/卸载反例；就地订正无变化时 scheduler 零 restart 策略，保留原 wire 协议与边界矩阵。

2026-10-26：据 full 回归真实失败补 remote-adapter 的四操作库存；补 repository 同键无重组 RED，排除 Core 会改写的 isDefault 派生标志，避免重复装配。

2026-10-26：自审补候选 timer 分配抛错 RED，将 timer 创建移到指针发布前；候选失败只 retire candidate，旧服务继续读且同键可重试，恢复 timer 异常只记安全诊断。

2026-10-26：记录最终九文件 133 项、9 项原边界及完整 1954 + 7 项与 typecheck 通过，未提交实现的发布面已人工复核；保持 active 等待独立对抗验收。

2026-10-26：采纳首轮独立 PASS 的 F1–F3，补 SQLite 晚写与 unary 二次实际读取永久证据，隔离副本 2/2 变异被指定用例杀死；保留原 watch 例和候选提交，未动 #131 工作树。

2026-10-26：记录 F1–F3 修复波次最终 134 项定向、9 项原边界、typecheck 及完整 1955 + 7 项通过；候选 7687e364 保持不改写，等待 scoped 复评后由协调者统一整理提交。

2026-10-26：据独立 scoped PASS 归档计划与索引；TD-081 转 Resolved，TD-055 只订正重组缺口，TD-058 保持原解决状态。代码与测试未因归档变更。

2026-10-26：协调者在 `feature/host-recomposition` 最终产品树重跑 `pnpm verify`，typecheck、1955 项和 MVP 7 项通过；归档后的发布检查另对最终提交运行。

- 2026-10-26 MMP 修复批：补并发 createWorkspace/connectAccount 的永久回归。阻塞首个候选装配，释放前 viewer 请求必须为零；移除 tail 串行的变异必须被此测试精确 KILLED。生产实现不变；回滚只移除新增测试与本次记录。

- 2026-10-26：MMP 非阻塞修复完成独立复评后归档，评审记录纳入 Global Constraints；最终提交与远端证据另行回读，不预写合并结果。
