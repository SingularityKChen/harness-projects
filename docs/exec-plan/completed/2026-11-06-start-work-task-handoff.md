# Start Work 显式任务交接 ExecPlan

> 状态：Completed；创建：2026-11-06；执行分支：`feature/start-work-task-handoff`
> 范围：#547；Refs #72、#143、#545；遵循根级 `PLANS.md`。

## Purpose / Big Picture

操作者在 Harness 的“开始工作”中明确填写任务，工作台把该任务原文交给新会话，并使用 Git 已确认的工作树作为目录。
最小成功证据是合成 SessionPort 在实际 Host → controller → core → Harness Provider 路径上收到精确任务、正确 cwd，且只发生一次 create/prompt。
这证明任务交接和运行确认，不证明模型完成任务、真实 Desktop 已验证或发布门禁通过。

## Context and Orientation

用户于 2026-11-06 批准四 issue、三独立 PR 的范围：#547、#548、#538+#542；本计划只负责 #547。
用户要求未发布产品无需旧数据、旧设计兼容；允许诚实拒绝旧实验请求，不授权迁移或删除旧操作。
Start Work 当前只接收工作项、仓库和可选分支；`packages/core/src/start-work.ts` 的 `startExecution` 生成 `harness run <branch>`。
`packages/providers/execution-harness/src/provider.ts` 将 `input.command` 原样作为 session prompt，并不执行 shell。
`packages/core/src/start-work-request.ts` 负责 primitive 快照与持久请求 fingerprint；`claimContext` 在外部写之前认领 mutation key 与 context。
context 身份由 workspace/item/repository 决定，run 身份由 context 决定；已有 run 不支持追加任务或第二会话。
`packages/capabilities/src/storage.ts` 的既有 external intent 已能保存完整 startRun 输入，首次 fingerprint 本身也是持久字符串。
`getExecutionContext` 与 refresh 是已有读路径；重启后的详情展示不需要重新提交任务。
本计划由两份独立设计经第三方审读收敛；下面完整记录最终契约，不依赖运行态研究文件。

## Design / Spec

### 明确输入与模式

新增 `task: string`，所有新 Start Work 表单均显示必填多行“执行任务”，初始为空；人工模式也记录明确工作意图，但不宣称任务已送模型。
界面说明只发送明确填写的任务；工作项正文不会自动成为指令。不得从标题、正文、选中项历史、分支或 issue 号自动填入。
所有新 Start Work 命令 task 必须是非空白字符串且长度不超过 16,384 UTF-16 code units；只用 trim 判空，不 trim、规范化、截断或添加模板。
允许 Unicode、换行与前后空白；原文从快照到 prompt 必须逐字符相等。错误与日志不得回显任务正文。
Core 对所有新命令统一验证 task，发生在任何 branch/worktree/session 写之前；不引入 executionMode 字段、Provider 名称分支或第二模式事实源。
只读详情/refresh 不要求 task；合法原请求带原 task 恢复。binding 在 await 中变化继续经过既有准入与 owner 检查，不得绕过输入身份。
人工运行或 fallback 的 running 只表明人工处理，不表示任务已送模型；不改 fallback 的既有诚实分类。

### 快照、持久身份与恢复

UI/client intent identity、Host positional codec、controller 显式转发、Core primitive snapshot 都包含 task。
拒绝非字符串与未知 authority 字段；沿用各入口既有存取器策略，不扩大描述符禁令；允许读取的声明 primitive 只捕获一次，throwing getter 安全失败，await 后不再重读。
首次 claim 事务必须把精确 task 纳入 requestFingerprint；不能等到 startRun external intent 才绑定任务。
使用明确的新 fingerprint 形状；缺省 task 是无效新命令。已有不支持的实验 fingerprint 保持只读、诚实冲突，不重写账本。
新 startRun 继续持久保存完整 input，`input.command = task`，cwd 仍唯一取 Git ack；requestId 和 context/run 身份规则不变。
任务不进入 providerRef、URL、environment、Planning 数据或第二任务表；无新 DDL。
同原 key、同原 task、同原目标可恢复；同 key 改一个字符即 conflict，零 Provider 写。
异 key 命中 pending/unknown：相同完整 fingerprint 只观察原操作；不同 task 或请求身份 conflict。
首次 claim 后、external intent 尚未落下的窗口也必须守住：在同一 claim 事务按 fingerprint 中的 scope 找到未决认领，不能漏过它再写新任务。
已有 run 或 Ready context 遇新 key 的 task 请求一律 conflict，稳定原因 `existing_execution_task_not_sent`；显示“已有执行，本次任务未发送”，指向现有执行区。
原 key 的合法恢复可返回原运行事实；不能把新任务冒认为已交接。非终态没有 run 时也不得把旧 context 的 confirmed 当作任务成功。
确定失败且没有 run 或未决启动意图时才允许既有显式重试/owner lease 接管，保留已确认 branch/worktree；不增加会话队列。
unknown 有 handle 时只 getRun；无 handle 时保持 unknown，绝不再次 create/prompt。延迟旧 owner 结果不能覆盖新代。

### 界面与取舍

pending/unknown 期间保留原请求、冻结任务字段；恢复按钮只读回原操作，不从编辑后的字段重造请求。
工作项、仓库、执行 binding、连接或组件 owner 变化时清空/隔离任务与迟回复，避免把旧任务送到新目标。
采用既有 `reason` 投影承载稳定“未发送”文案，Host 仅放行该固定原因；不增加 broad DTO/status。
拒绝自动拼接 Issue 正文：它新增来源版本、权限与不可信输入边界，超出本轮明确任务闭环。
拒绝 prepare-then-send 新命令：它引入第二阶段与额外持久状态；本轮复用一次启动与只读恢复。
拒绝为已有 run 追加 prompt：当前 session/run 身份不支持第二次任务归属。
拒绝 Core 按 Harness Provider 名称豁免人工 task：Core 没有模式字段，为空任务增加模式系统会扩大本轮范围；统一显式工作意图更简单。

## Global Constraints

唯一完整改动集合：`packages/core/src/{execution-context,start-work-request,start-work}.ts`、`packages/client/src/start-work.ts`、`packages/ui/src/start-work-section.ts`、`packages/capabilities/src/execution-provider.ts` 的契约注释；下述共享接口区域；新增 `tests/integration/start-work-task-handoff.test.js`；已有 Start Work、Harness execution、UI/Host ABI tests 及其对应 synthetic fixtures（统一在测试调用/helper 中提供固定 synthetic task，不加生产默认值）；本计划与必要演示说明。
共享文件由本 PR 实现者作为唯一接口 integrator 串行写入：`packages/controller/src/commands.ts` 的 StartWork input/runStartWork/startWork 成员，`apps/harness-plugin/src/host-operations.ts` 的 startWork descriptor/参数数量守卫，`apps/harness-plugin/src/host-composition.ts` 的 startWork handler，`apps/harness-plugin/src/client.ts` 的 startWork adapter，以及 `tests/contract/harness-host-operations.test.js` 的 Start Work 专属测试。
#548 owner 只提交该文件内 createChangeRequest/operation 对应区域的最小 patch；integrator 先在本分支完成 task 区域，再切到 Draft 分支串行应用 PR 区域，不能带入另一 PR 的产品改动。
两个 PR 均独立以 main 为 base；同一个成员/通用 helper 只能由 integrator 修改，避免同时编辑相邻区域或生成描述符。
Markdown owner 的两个展示器与对应 tests 完全独立；`docs/README.md` 由父协调者串行维护。
每 PR code/test/config 增删合计严格少于 800 行，文档少于 1300 行；接近上限先缩范围并修订计划，不能省掉身份/恢复测试。
保持 Node >=22、pnpm 10.28.2、现有 Provider/session API；不引入兼容适配、DDL、模型调用或 Desktop 操作。
不写 Status、blocked-by/blocking，不合并，不自动启动 #545；#72/#143/#449/R1 的人类判断独立保留。

## Plan of Work

所有命令在检出 `feature/start-work-task-handoff` 的 `.worktrees/iteration9-task-handoff` 根目录运行；记录实际 head、时间和输出，不能把计划命令写成已执行。

### Batch 1 · 设计冻结与 Draft PR

最小闭环：锁定输入/恢复契约，形成可评审设计与关联 #547 的 draft PR。
涉及主文件：本计划；尚不改生产行为。
步骤：确认 worktree realpath 与 clean 状态，复读本计划；加入合成 red 测试设计与共享区域交接；整理文档提交后由协调者创建 draft PR，描述 Refs 父项与边界。
验证命令：

    pnpm test:file tests/integration/start-work-request-binding.test.js tests/contract/harness-execution-contract.test.js
    git diff --check origin/main...HEAD

期望：基线相关用例 pass、diff 无空白错误；draft PR 具有同仓 #547 关联，未宣称实现完成。
回滚：撤销本批文档提交即可，不触碰既有工作树、session 或 mutation 账本。

### Batch 2 · RED → GREEN 最小任务交接

最小闭环：先让实际组合中的 exact task、未决任务冲突与已有 run 防误报测试失败，再实现输入贯通。
涉及主文件：`packages/core/src/start-work-request.ts`、`packages/core/src/start-work.ts`、新增任务交接 integration test。
RED 记录失败断言、原因及零真实模型证据；先测量 required task 带来的 fixture diff，优先在现有 synthetic helper 提供固定测试任务，避免大量重复编辑；不能用生产默认值或放宽断言控制规模。
GREEN 才接入 UI/client/Host/controller、首次 fingerprint 与 exact command；共享文件只由 integrator 写，Batch 2 中途测实际 code/test/config 增删并在达到预算前收敛。
必须覆盖 caller await 变异、Unicode/空白/过长/错类型、人工有 task、所有新命令缺 task 零 Git 写、同/异 key、first-claim 窗口、Ready/new key、SQLite restart、丢 ack 与 owner fencing。
验证命令：

    pnpm test:file tests/integration/start-work-task-handoff.test.js tests/integration/start-work-request-binding.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/start-work-owner-fencing.test.js
    pnpm test:file tests/contract/ui-start-work.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-execution-contract.test.js tests/integration/harness-plugin-start-work.test.js tests/integration/harness-plugin-host-execution.test.js tests/e2e/start-work-recovery.test.js

期望：全部 pass；合成 session create/prompt 各一次，恢复为零新增写；新 task 未发送时明确 conflict。
回滚：撤销本批代码提交并保留账本与已确认外部资源；未知操作继续只读，不尝试删除或重建。

### Batch 3 · 独立验收、整理与 Ready

最小闭环：独立验收者审读不变量/错误路径/测试判别力，重构后重跑相关验证，再提交最终可评审 head。
涉及主文件：本计划的实际证据与必要测试修订；父协调者负责索引与组合检出。
验证命令：

    pnpm typecheck
    pnpm boundaries
    pnpm test:file tests/browser/workspace-execution.test.js
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,closingIssuesReferences,reviewDecision
    gh pr checks --repo SingularityKChen/harness-projects

期望：相关测试、发布扫描及人工五类目通过；当前远端 head/base、所有 review threads 与 checks 完整回读，`PR Fast Gate` pass；历史已知 advisory 若出现须具体归因，不能冒称全部绿。
共享 integrator 在包含三个最终 head 的临时 integration 分支额外运行两 feature integration suites、Host ABI suite、`pnpm typecheck` 与 `pnpm boundaries`，证明组合没有字段互相覆盖。
最终 push 前整理临时/fixup 提交；已推历史改写先建 backup ref，按精确 old-head lease 规则执行。验证最终 head 后由协调者标 Ready，不合并。
回滚：整 PR revert；外部资源和未知账本保留；不把 revert 当作取消会话。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 明确任务逐字到 fresh session | 实际 Host 组合捕获 exact prompt、Git ack cwd、一次 create/prompt；Issue-body canary 未注入 |
| 最早持久绑定与不可变输入 | 首次 claim SQLite 记录含 task；caller 变异、允许 getter 单次读取/throw 安全失败及既有拒绝边界测试 |
| 任务更改不误报成功 | 同 key/异 key、first-claim 窗口、Ready/restart changed task 均 conflict 且零 session 写 |
| unknown 不重复启动 | drop ack、无 handle、重启及 owner fencing 判别用例，create/prompt 计数不增 |
| 人工模式与权限隔离 | manual 有 task 正控；所有模式缺 task 零 Git/Provider 写；redacted/wrong target 拒绝 |
| UI owner 与恢复稳定 | 冻结原字段、换 item/repo/binding 清空、迟回复不污染、稳定未发送提示 |
| 工程可审阅 | 独立审读、最终 head checks/readback、实际规模与发布检查记录 |

工程 PR Ready 无需新增付费模型调用或完整人工 UAT；真实安装件 Desktop 复查与 #545 任务产物是另行证据，不得标记 #72/#143/#449/R1 已验收。

## Progress

- [x] (2026-11-06 SGT) 完成两独立设计综合与源码审读，记录用户范围授权。
- [x] (2026-11-06 SGT) Batch 1：设计冻结；协调者已创建 Draft PR #549，初始 head `2043f9c731956b7af33004c385f781f73e4fc0c3`，双向关联 #547；基线 41/41。
- [x] (2026-11-06 SGT) Batch 2：显式任务全链路、首次 claim 与安全恢复完成；相关 321/321、UI/Host 80/80、浏览器 4/4、完整套件 3535/3535；typecheck 与 boundaries 通过。
- [x] (2026-11-06 SGT) Batch 3：独立验收、组合验证与最终 Ready。

## Surprises & Discoveries

2026-11-06 源码审读：`claimContext` 的首次 ledger 早于 external intent，原 pending 查询只看 externalIntent.contextId；只改 prompt 会漏掉最早并发窗口。
2026-11-06 源码审读：`startExecution` 对已有 run 直接返回 existingRun；新增 task 字段本身不能证明新任务已交接。
上述缺口已由 Batch 2 的 RED/GREEN 判别用例验证修复。
2026-11-06 实施：原测试已明确未决外部步骤的观察新键不消费 receipt。这里只绑定真正认领写入的 key，观察者不能替换原任务；尚未消费的观察 key 不成为第二份权威记录。
2026-11-06 实施：首次 claim 或 Git 已确认步骤后的本地空窗，在没有未决 external slot、没有 run 且 owner lease 到期时允许同完整任务续跑；安全接管在同一事务将旧 claim 结算 failed/conflict。这样后继确定失败后，旧无 intent 认领不会永远挡住新的任务。任何真正未决的旧代 external create/start 仍保持只读，不因 generation 变化而被遗忘。

## Decision Log

2026-11-06 / 人类授权、综合审读者记录：四 issue/三 PR，只交付本 #547 工程闭环；不启动真实模型、不改 Desktop/规划状态。
2026-11-06 / 综合审读者：采用显式原文 task、人工/Harness 新命令统一必填；理由是 Core 没有模式元数据，统一显式意图可杜绝空会话且不新增 Provider 分支。
2026-11-06 / 综合审读者：已有 run 新 key 固定 conflict，不加新 run 身份/队列；理由是当前单 run 模型无法承诺第二任务归属。
2026-11-06 / 人类范围、协调者确认：无旧实验数据兼容/迁移；不支持的旧 fingerprint 只读拒绝，成本是可能需要人工恢复原实验操作。

## Idempotence and Recovery

测试与只读查询可重复；首次 requestFingerprint 和 external intent 是原任务唯一持久依据，UI 草稿不是权威。
确定失败可按既有 lease/owner 显式重试；可能已接受的 prompt 永远只观察。恢复不接受新任务替换原任务。
不支持的旧请求保持资源/账本、报告 conflict/unknown；没有删除、猜测默认任务或自动升级。
回滚以 PR 为单位；新会话若已产生需独立人工处理，源码回滚不撤销真实外部效果。
若实现主动延期影响身份/恢复/安全的必要项，先记录 `docs/exec-plan/tech-debt-tracker.md` 并保持工程门未通过；纯后续便利功能不伪装成技术债。

## Interfaces and Dependencies

依赖现有 Node/pnpm、synthetic SessionPort、SQLite/fake storage 与 Host descriptor 生成；不需要模型凭据。
`task` 属执行意图，不是 Capability/Planning authority；`ProviderStartRunInput.command` 仍是一轮纯文本工作负载。
测试使用假仓库与合成任务；公开证据只用可移植路径与无敏感信息 canary。

## Outcomes & Retrospective

Batch 2 在 `.worktrees/iteration9-task-handoff`、`feature/start-work-task-handoff` 实现。新命令必填 task，原文进入 v2 fingerprint 与 startRun command；Host → controller → core → Harness session 的合成 create/prompt 均只发生一次，cwd 来自真实 Git ack。人工运行与 fallback 继续只说明人工处理。
RED 先观察到旧合成 command、缺 task 仍写入、首次 claim 异任务漏挡、getter 未捕获；随后对 UI 收起恢复、旧实验 fingerprint、失去 Development 路由、旧 claim 误借权威和后继确定失败分别增加判别 RED，再修复到 GREEN。错误与日志不回显任务内容。
2026-11-06 本地验证：Batch 2 两组命令分别 321/321 与 80/80；`pnpm test` 3535/3535、`pnpm typecheck`、`pnpm boundaries`（9/9）与生产组合浏览器 4/4 通过。完整套件包含必要 fixture 的显式 synthetic task 更新，没有生产默认值。本地 code/test/config 增删合计 799 行；最终发布扫描与远端 head/checks 由协调者回读。
替换的旧测试矩阵包括已有 run 后用新 key 重建 Git、借旧 run 报成功、随之进入的 receipt 故障与 admission/owner 路径；这些入口现在拒绝新任务，因此改为 Fake/SQLite、主/备用、Ready/Failed、已知/unknown run 的零写冲突判别。保留原 key 的 unknown/restart、确定失败且尚无 run 的重试、实际不可见/异绑定拒绝及迟到旧 owner 的 fence。PR 后继代际测试使用明确的 Storage fixture，不能再声称已有 run 的 Start Work 会创建后继代际。
独立审读在 `83735be5` 找到 F1/P1（原 key 安全恢复不可达）与 F2/P2（离线路由分类漏过任务冲突）；同批修复后维护与独立六反例均通过。原 key 在完整任务/原 binding、lease 到期、无 run/任何未决 external slot 时再次于 claim 事务复核并推进 owner；客户端继续保留原 key。路由离线也共享持久 pending 身份与 run 拒绝裁决，不再漏掉 Failed+run 或最早 claim 的异任务。
最终修复验证：`pnpm verify` exit 0（typecheck、完整 3535/3535、MVP0 8/8），维护恢复用例 52/52、相关覆盖 335/335、独立新增六反例 6/6、浏览器 4/4 与 boundaries 9/9。MVP0 原先的新 key 重复确认预期已改为同原 key/原 task；node4 也明确传入 synthetic task。
Batch 3 独立复评、三 PR 最终组合验证、最终 push/Ready 尚由协调者办理；未合并，也未获得 Desktop、真实模型或 #72/#143/#449/R1 人类验收。



2026-11-06 17:21 SGT / 协调者最终工程验收：代码在 `07e966548e20` 已经独立全量审读及修复复评，P0/P1/P2/P3 均无遗留。明确任务逐字交接、原请求可达的安全恢复、确定拒绝回执原子结算和连接变化拒绝均已完成；未决外部效果保持只读。
最终单次 pnpm verify：3541/3541 与 MVP-0 8/8；相关 385/385、执行/详情 browser 9/9；独立复评 11/11 反例与 50/50 相关用例通过。
最终三能力组合在 `test/iteration9-critical-path-integration`、观察 head `58259b340fa9` 运行 `pnpm verify`（typecheck、3566/3566、MVP-0 8/8）、`pnpm boundaries`（9/9）、两能力 Host/ABI/恢复定向 243/243，以及 `pnpm test:file tests/browser/workspace-execution.test.js tests/browser/safe-markdown.test.js tests/browser/detail-expand.test.js`（17/17），均通过。组合只在本地模拟；两份 Host ABI 测试冲突保留了 task 与 Draft 两侧断言，不包含仓库 main 合并。
最终发布 head 仅在上述已审代码上收口本计划、索引及必要用户说明；以 `gh pr view 549 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,closingIssuesReferences`、`gh pr checks 549 --repo SingularityKChen/harness-projects` 和 reviewThreads 回读当前状态；只有最终 head 的 `PR Fast Gate` 通过才转 Ready。不能沿用旧 head 的 checks。
工程验收完成，计划迁入 completed；真实模型、安装件 Desktop 复查、#72/#143/#449 与 R1 人类裁决继续保留。未新增必须延期的技术债；revert 不撤销已确认的外部资源或未知回执。

## Bottom Change Note

2026-11-06 SGT：综合两设计与源码，锁定首次 claim、已有 run 未发送、两模式统一显式任务及共享接口串行 ownership，建立三批工程验收路径。

2026-11-06 SGT：按现有入口语义收窄存取器要求为单次 primitive 捕获，增加 required task fixture 的早期规模测量与 synthetic helper 收敛。

2026-11-06 SGT：完成 Batch 2 TDD 与有界验证；明确只观察未决原请求、安全 lease 接管时结算旧认领，以及真正未决旧代 external intent 不失忆的恢复规则。

2026-11-06 SGT：按独立审读 F1/F2 修复原 key 安全 lease 恢复与离线路由拒绝分类；未决旧代 external create/start 保持只读，未在客户端盲目换键。复用既有安全恢复矩阵覆盖实际 client/controller 路径；移除纯内部 provisionGit 测试不消费的无关 task 字段，原断言保持。最终 code/test/config 794 行，完整 verify 含 MVP0 通过。

2026-11-06 SGT：第二轮 scoped 复评 `1036c1d4` 新增 F3/P1（同原 key 的安全续供被确定拒绝后 receipt 仍 pending）与 F4/P2（原 binding 改变时恢复分类退化）。维护 Fake/SQLite × claim/Git-ack × 原键/新键拒绝矩阵，确认 Failed context 与原 receipt 在同一事务结算为确定失败；只有已证明无未决外部效果的安全认领走此分支。`safeResume` 在外层与事务内验证原 binding，正式路由再次改变时回既有 target-changed 重放拒绝。所有旧代 unresolved create/start 保持只读。detail-expand 浏览器 fixture 明确填写 synthetic task，原 draft/pending/focus/AST 断言不变。整理四个被随后同值 spread 覆盖的重复 synthetic task 字段，不删断言或压缩逻辑；最终代码增删 799 行。最终验证与不可变 head 在运行报告记录，Batch 3 仍待独立复评和协调者最终组合/远端回读。

2026-11-06 17:21 SGT：记录最终独立复评与三能力组合证据，迁移完成计划并同步索引及必要演示说明；最终发布按当前 PR head 回读门禁，保留全部人类验收边界。
