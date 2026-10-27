# Harness 会话执行绑定 ExecPlan

> 状态：Completed（原能力已归档；本轮评审修复本地验证通过，独立复评与发布回读由根会话执行）
> 创建：2026-10-27（Asia/Singapore）
> 范围：#359 的生产执行安装入口、Host catalog、lazy session 适配与人工备用
> 规范：根 `PLANS.md`；分支 `feature/session-execution-binding`；基线观察 `2026-10-27 @ b164a211b0b0d9669724dc794c2fe32896c4eed0`

## Purpose / Big Picture

工作区使用者在设置中显式启用 Harness 执行后，Start Work 在 Git 确认的工作树中创建会话并落下 run；会话服务明确不可用时沿 Core 既有人工备用路径保留工作树并记录 `manual_fallback`。演示者可以用默认关闭的强制失败开关验证这一路径。

最小证据是 Host remote→实际 Local Git 临时工作树→原始 session service 适配→录制会话夹具→SQLite run 的闭环。它证明会话启动与记录，不证明模型完成工程任务、当前 Desktop 兼容或持续 run 刷新。#136 还需真实 repository 的 steps 6–8 与真实 Harness session 走查，#143 仍承担 Desktop/真实模型与全流程演示；本 PR 不自动关闭父项或通过 R1。

## Context and Orientation

事实：`packages/providers/execution-harness/src/session-port.ts` 是 session-probe-v1 归一端口，并非 raw `ctx.sessionController`。Provider 已实现 create/prompt/read 的预算、requestId 与失败分类。`packages/core/src/start-work.ts` 已拥有工作树保留、明确启动失败转人工、ambiguous 不重复执行的策略。

事实：`apps/harness-plugin/src/host-providers.ts` 当前无 execution catalog 条目，非 development 全走一个槽，不能恢复 executionFallback。`host.ts` 顶层只 inject typert，credentials 每次 `ctx.get`；session 服务不能成为 root 必需注入，否则缺服务时整个插件可能不进入 apply。

事实：`packages/providers/execution-human/src/index.ts` 必须使用稳定 bindingId 和至少 32 字节 issuerKey，HMAC 验证旧 run 引用。进程随机 key 或从公开 ID 推导“密钥”都不成立。当前 secret allowlist 只有 GitHub handle；本批必须补真实稳定句柄解析。

依据是 issue #359 三条 AC、`docs/architecture/harness-session-api.md`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`、TD-054。录制夹具位于 `tests/contract/fixtures/harness-session/session-api.json` 与 `replay.js`，只代表观察过的 Harness 0.2.0-rc.2 Web 行为，不把当前宿主版本当已验证兼容。

两个独立研究者分别比较 lazy ctx.get 与嵌套 inject；本作者用 First Principles 的失败边界、Qian 的安装→执行→恢复闭环审阅，保留按操作 lazy 方案，修订为唯一显式生产安装入口及按操作稳定 secret wrapper。主要不确定性是 prompt 后不确定结果会不会错误触发第二执行者；测试优先锁住这一反例。

## Design / Spec

唯一生产安装入口是工作区设置中的“启用 Harness 执行”按钮，经 setup source 调 `installExecutionBindings(actorRef, idempotencyKey)`，由 Host 注入 workspace，转窄 Core setup 命令。一次事务创建 Harness `isDefault=true` 与 human `isDefault=false` 两个 execution mount；两行 ID 首次创建后持久保存，相同 intent 重放读回同一 pair，不每次 compose 生成 ID。命令 ack 后走既有 configure 重组。

普通启动只 restore，不自动创建、补齐或复活 execution 行。已有任何 execution mount 时只允许同一已安装 pair 的幂等确认；自定义、冲突或 disabled 行返回结构化 conflict，不改 enabled/isDefault。没有删除 tombstone，故不声称记住 absence；如果 pair 被移除，只有用户再次显式启用才可安装。只加一个窄按钮，不扩张为通用 execution 设置或卸载 UI。

Host catalog 收录既有 execution.harness 与 execution.human 实现。restore 按 binding 的 `isDefault` 选择 execution/executionFallback，两个槽独立检查冲突，角色选择与枚举顺序无关；同槽多个启用记录禁用该槽并逐个报告 conflict，不按先到先得选任意执行者，另一无冲突槽不受连带覆盖。不能让 human 覆盖 Harness。human entry 始终声明 fallback=true。没有修改 Provider/Core fallback 算法的必要。

Host session adapter 每个 create/prompt/inspect/list 操作通过 resolver 执行 `ctx.get('sessionController')`；缺服务或 `ctx.get` 抛错转固定 unavailable，不能阻止 Host ready。保留方法 receiver，将同步返回/throw 包成 Promise；遵守现有 signal/预算、晚 ack 后不继续 prompt。inspect 仅从 event.data 取 turn/reason，从 data.source 取 user/rpcId，过滤非 user 消息；输出 SessionPort 白名单，不持久化原事件、prompt、模型错误原文。服务可晚到、重载或操作中消失；wrapper 不缓存服务。

人工备用新增固定 `HARNESS_PROJECTS_MANUAL_ISSUER_KEY` allowlist 句柄；配置/数据库只保存该句柄。安装者通过宿主 credentials 服务预置至少 32 字节高熵密钥并在 demo 期间保持稳定；既有 resolver 是读取入口，不假设宿主存在写 secret API。目录返回窄 wrapper，能力描述不读 secret；每个 start/get/cancel 操作 lazy resolve，当前调用内构造真实 human provider。缺值/短值/解析失败结构化拒绝，不能生成伪有效引用。key 只在调用内存中存在，不进日志、DTO、configuration 或 DB；重启同 key 必须可读旧 ref，key 轮换后的自动旧引用验证不在本批范围。

文档必须把该句柄的宿主配置前置条件写明，并区分“Host 已加载”“execution mount 已启用”“备用 key 可用”。没有 key 不宣称可靠人工备用；不借 GitHub token 派生、不硬编码公共字符串、不用随机进程 key。稳定句柄与生产安装链都必须在测试中真正使用，而不是 seed 两行绕过入口。

故障开关为 Host 环境变量 `HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE`，只有精确值 `1` 开启，缺省/off/其他值关闭。由 Host 组合时读取，改值后重启生效；SessionPort.create 包装器在任何 session 外部调用前抛固定 unavailable，0 create/0 prompt。它只影响后续新 Start Work，不伪造已有 run，不放进浏览器输入或 Project 数据库。

替代比较：顶层必需 inject 会破坏缺服务降级；嵌套子 fiber 增加准入/卸载竞态但尚无必要；UI 直接调会话或伪造 run 破坏 Host/ack 权威。自动 assemble 种行难以保留用户停用意图，故选择显式单入口。prompt 已接纳后的超时/失联必须 unknown，不能用故障开关制造此情形后又转人工；turn/end 的模型凭据失败也不能冒充 start unavailable。

### 评审修复的结束机制比较（2026-10-27）

F411-1 已由独立子评审和根会话分别在真实 Host/SQLite 重现：首次安装 ack 后读回失败，后续 refresh 确认安装却未结束旧键，移除 pair 后再安装重放旧成功。

1. 在每次 refresh 完成后检查当前 snapshot 并直接清键：改动少，但无法证明该配置读数属于当前已 ack 意图；unknown/pending 或旧 read 都可能被误结算，放弃。
2. 在 source 持有有身份的安装意图及“已收到并校验 local_only pair ack”事实，仅由该意图之后开始、当前 revision 的成功 Host 读数结算：选择。沿用已有 revision 栅栏，以对象身份防止旧 read 结算新意图；activationError 保留意图，后续干净读数才结束；未 ack 不因已有配置读数清键。
3. 在 DTO 增加绑定 ID 或命令 receipt 并按其对账：关联更强，但需要扩张公共 wire/Host 接口，本问题是 client 既有恢复路径失联，暂不采用。

## Global Constraints

保留七条不变量；不改 Planning Status、StatusPolicy、Core fallback、execution-harness/human 内部协议、cancel 语义、run 持续刷新或迁移。`harness run <branch>` 当前仅作为文本 prompt，不宣称为经过验证的任务执行协议。不触发真实模型或部署操作。

允许文件集合仅在此声明：新增 `apps/harness-plugin/src/host-session-adapter.ts`、`apps/harness-plugin/src/host-execution.ts`、`packages/core/src/execution-setup.ts`、`tests/integration/harness-plugin-host-execution.test.js`、`tests/contract/host-session-adapter.test.js`；修改 `apps/harness-plugin/src/host.ts`、`apps/harness-plugin/src/host-providers.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/client.ts`、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`、`packages/core/src/workspace-setup.ts`、`packages/core/src/index.ts`、`packages/controller/src/commands.ts`、`packages/controller/src/index.ts`、`packages/client/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`、`tests/integration/workspace-setup-commands.test.js`、`tests/integration/harness-plugin-host-providers.test.js`、`tests/contract/harness-host-operations.test.js`、`tests/contract/ui-workspace-setup.test.js`、`tests/contract/package-boundaries.test.js`、`docs/product/demo-install.md`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`、本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`。复用既有录制夹具，不生成新的大份复制数据。新 helper 依赖边只白名单到精确文件，不放宽 apps。

code+tests changed lines ≤800，docs ≤1300；初估 adapter/catalog/secret 180–230、安装写者和全部接点 160–200、测试 250–320，合计 590–750，预留至 780；锁文件/生成目录按仓库政策排除，其他 fixture、旧断言与接点全部计入。安装入口和稳定 key 会增加体量；超预算先复用夹具/删除范围外重构，仍超限则回到方案门重切独立闭环，禁止削 unknown/secret/重启测试或伪称生产已接线。

execution owner 独占新增适配/安装模块及 host-providers、host.ts；共享 host-composition Options/env、host-operations、setup source/command、setup UI、client.ts、包 index、boundary、manifest/lock 由主控指定唯一集成人串行落 patch。#358 与本 lane 不并发写 workspace-setup；这里只添加单一安装按钮及状态，不改 mapping 功能。索引在已有 `2026-10-26-harness-execution` anchor 后插入；TD-054 只更新执行条目/备用槽已解决范围，GHES/多账号等保留。

执行不改 Project Status、blocked-by/blocking；#359 的 2026-10-28 checkpoint 可由主控机械补 iteration 8，不能由工程事件判断验收完成。

## Plan of Work

### Batch 1 · 显式安装到会话/人工执行确认

最小闭环：真实设置入口 → 幂等 pair mount → catalog 恢复 → Start Work → Git ack cwd → SessionPort 或 human ack → run 落账。主文件为 execution-setup、host-session-adapter、host-execution 和 host-providers；完整集合见 `Global Constraints`。

1. 本计划独立审阅后，先做 plan commit 与 draft PR，关联同仓 issue #359 并双向回读 head/base/draft、closingIssuesReferences、文件范围；未实现时不宣称 AC 完成。然后先写 RED：Host 未有安装操作和执行目录，raw service 的 event.data/source 与 receiver 测试失败；新增测试先证明行为缺口，不能以文件缺失代替判别性红测。
2. 实现一个窄幂等安装事务、setup 命令/按钮与 configure；用正式入口建 pair。测试重复安装/重启 ID 不变，已有/disabled mount 不覆盖，半写失败回滚，空工作区结构化拒绝。
3. 实现 catalog 两槽路由、lazy raw session adapter、按操作 secret wrapper、create 前强制失败开关。fixture 只作录制行为回放，另补 raw 嵌套事件、同步方法、this、服务晚到/消失的判别例。
4. Host 集成使用真实 Local Git 临时仓库、SQLite 和录制 fixture：验证 ack realpath、Core requestId、run/ref/状态、重复 Start Work 单 session。缺 service 和强制失败必须保留真实工作树并 manual_fallback；prompt 后 ambiguous 必须 0 human start。
5. 集成人落共享 patch，跑窄回归再完整 verify/打包验收；独立验收者检查完整 AC、不变量与失败反例后做必要重构，并重跑受影响验证。更新本计划与部分债务，将初始计划和最终实现整理为一个能力整合 commit `feat(execution): 接通宿主会话与人工备用执行`，末尾 `Closes #359`。
6. 最终 push 后回读当前 head/base/checks/所有 review threads/issue 关联，当前 head 验证通过才 ready 并请求人类 review；不自行合并。已推分支若整理历史，先建 backup ref 并按 expert 精确 lease 流程。

以下命令均在检出 `feature/session-execution-binding` 的工作树根运行：

    pnpm test:file tests/integration/harness-plugin-host-execution.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/workspace-setup-commands.test.js tests/contract/ui-workspace-setup.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-session-api-record.test.js tests/integration/harness-execution-fallback.test.js tests/integration/human-execution-provider.test.js
    pnpm typecheck
    pnpm run boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js
    pnpm verify
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望选定测试、typecheck、boundaries、artifact 与 verify pass；disclosure 无命中；机械规模通过并人工核对本批 800/1300；diff-check 无输出。文档核对默认关闭、启用/关闭开关与稳定 secret 前置条件。scout 基线 verify 2086 + 7 由主控执行，本计划不把它当新增行为证据。

回滚点是单能力 commit；恢复旧插件后未知执行 mount 局部禁用，保留 context/run/工作树。已接纳的外部 session 仍是已发生事实，不能删除记录假装撤销，也不自动取消/删分支。

### Batch 2 · F411-1 读回恢复后的意图结束

最小闭环：真实 Host/SQLite 的 local_only 安装 → 首次读回失败 → refresh 确认 → pair 移除 → 再安装得到新 key 与两条实际挂载。主文件为 `packages/client/src/workspace-setup.ts` 与既有 Host execution/adapter 测试；完整集合见 `Global Constraints`。

先新增失败回归，确认 `executionInstalled` 缺失或绑定数 0 的 RED，再引入 source 级已 ack 意图；增加 unknown/pending 的普通 refresh 不得清键、activationError 恢复、旧读数不得结算新意图的保护。验证：

    node --test --test-timeout=120000 tests/integration/harness-plugin-host-execution.test.js tests/contract/host-session-adapter.test.js tests/contract/ui-workspace-setup.test.js
    pnpm typecheck
    node scripts/review-mutate.mjs "$HP_REVIEW_EVIDENCE/pr411-findings.json"

期望最终窄测与 typecheck pass，最终产品树变异整表归因 KILLED，脚本按字节还原。回滚只撤销本批 source 与测试变更，不删除挂载、运行、工作树或外部会话。外部 review、commit/push 与 rebase merge 交根会话；本执行者不操作。

## Validation and Acceptance

| # | 验收项与反例 | 判定证据 |
|---|---|---|
| AC1 | 正式安装 pair 后 Start Work 在 Git ack 工作树创建 Harness session 并记录 run | Host remote + raw adapter + 录制 fixture + SQLite；cwd realpath/requestId/ref/getExecutionContext 一致 |
| AC2 | 缺 session service 仍 Host ready，Start Work manual_fallback 且保留工作树 | 真实工作树存在；run running + manual_fallback；0 session create/prompt |
| AC3 | 强制 start 失败开关文档化、默认 off、仅精确 1 生效 | 环境变量矩阵与安装指南；开启时所有 session 外部调用为零 |
| F1 | 安装幂等、角色恢复不靠遍历顺序、同槽冲突拒绝、disabled 不复活 | 正式安装命令与逆序恢复/重复角色用例 |
| F2 | prompt accepted 后 timeout/ack 丢失只能 unknown，无第二执行者 | 保留既有 Core fallback 回归 + Host 故障注入计数 human start=0 |
| F3 | turn/end 缺模型凭据为 failed，非 start unavailable | raw event→Provider/Core 的分类断言，不能错误 manual_fallback |
| F4 | 稳定 key/ID 重启能读原人工 ref；坏 key 拒绝且 key 不落库/日志/wire | 同 DB 关闭重开、同 secret resolver；字节陷阱扫描与缺值/短值用例 |
| F5 | 同步 raw 方法、this、非 user 消息、服务重载与卸载 | adapter 契约测试；Host stop/drain 后零新外部调用 |

## Progress

- [x] (2026-10-27 +08) Batch 2：先写真实 Host/SQLite `read-recovered-pair` 回归，未改实现时 `executionInstalled` 实际 undefined、期望 true，退出码 1；同时 activationError 后干净读取结算回归失败，29 测试中 27 pass / 2 fail。
- [x] (2026-10-27 +08) Batch 2：引入 source 级 acknowledged 安装意图，以对象身份、当前 revision、命令/激活/读取错误栅栏结算；GREEN 为 Host execution + adapter + UI setup 49/49，`pnpm typecheck` 通过。
- [x] (2026-10-27 +08) Batch 2：最终产品树统一 9 项变异整表全部归因 KILLED，退出码 0，基线及还原后基线均通过且按字节还原；未再修改产品树。
- [ ] Batch 2：根会话交另一评审者独立复评，重组最终候选并按当前 head 回读门禁后整合发布。

- [x] (2026-10-27 15:33 +08) 复核双独立研究、session/raw 记录、catalog/Core/secret 所有权。
- [x] (2026-10-27 15:33 +08) 收敛为唯一显式安装链，写入本计划；尚未实现。
- [x] (2026-10-27 +08) 完成生产安装写者、setup/remote/UI 接线、lazy raw adapter、双槽恢复、稳定密钥与故障开关；初始 RED 为目录缺执行实现及正式 setup 缺安装命令的两条真实断言失败。
- [x] (2026-10-27 +08) 本地验证：窄回归 130/130，boundaries 9/9，pack 与 artifact 38/38；`pnpm verify` 的 typecheck、2102 个主测试及 7 个 MVP0 测试通过。执行上下文均为本计划声明的 `feature/session-execution-binding` 工作树；未提交实现，独立验收仍待完成。
- [x] (2026-10-27 +08) 独立评审 R1 复现了永久安装键导致同页重试/重新安装失效；新增真实 Host + SQLite 持久回归先出现 2 条断言失败，再修复安装 intent 生命周期。确定失败后下一次显式提交换 attempt；成功且 Host 确认安装后结束 intent；unknown/pending/畸形/读回失败/激活失败保留原键。独立复评仍 pending。
- [x] (2026-10-27 17:03 +08) 原独立验收者已逐条复评通过；所有本批发现均已修复，未以作者自审替代独立验收。
- [x] (2026-10-27 17:03 +08) 三能力本地并集验收通过，完成归档和索引；发布与 ready 的易失状态由本计划末尾的 GitHub 命令控制，不把工程验收当作人类规划接受。

## Surprises & Discoveries

Batch 2：初审 59 个窄测试全绿仍遗漏“安装 ack 后首次读回失败，再以普通 refresh 确认，随后同页移除并重新安装”的组合。单次调用局部 accepted 无法跨 refresh 存在。修复中把 local_only + activationError 视为已提交 ack，但当前错误动作不结算；后续无激活错误的当前版本读数才能结束。unknown/pending 即使读到既有安装配置也不获得 ack。

独立评审 R1：实例内 Controller replay 会正确保留旧键结果；source 若永久复用安装键，会在 disabled 冲突修复后仍返回旧 conflict，或在 pair 移除后重放旧成功而不真正重装。修复仅结束已确认完成的 intent，保留未知及激活失败的恢复键。

人工密钥 resolver 若悬挂也会阻塞 Host 排空；本批新增 30 秒预算，时间推进反例先红后绿，晚到 secret 不再继续签发。SQLite 写入新的 default 会自动收拢旧 default，损坏同槽反例通过只读挂载端口注入，避免用无效数据库行冒充合法存储状态。

原始 SessionPort 注释明确要求 Host 适配 raw data/source，不能把归一 fixture 直接当 raw adapter 证据。human provider 的 issuerKey 是持久引用来源边界；普通启动随机生成 key 会在重启后使旧引用不可读。Host 现行单槽恢复也不能只加 catalog 两行就满足人工备用。

## Decision Log

- Decision：按方案 2 修复 F411-1，保留 acknowledged intent 到当前版本的成功 Host 读数确认；local_only + activationError 是提交 ack，但当前失败动作不直接结算。Rationale：让读回恢复与普通成功共享结算点，又保留未知结果同键。Date/Author：2026-10-27 +08 / 本轮修复者。
- Decision：根会话记录人类已授权本会话负责 P2 修复、独立复评、归档整合至 rebase merge；本子执行者仅改已指定文件，不执行外部写入或 Git 发布。Rationale：遵守本轮独占 ownership 与人类逐 PR 授权边界。Date/Author：2026-10-27 +08 / 根会话转交。

- Decision：只加显式 installExecutionBindings 命令/按钮，启动时不种行。Rationale：生产入口完整且保留用户已有/disabled 挂载，无删除 tombstone 不推断 absence。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：lazy ctx.get + 按操作稳定 secret wrapper，顶层 inject 不变。Rationale：服务晚到/缺席不阻断 Host，重组不捕获旧服务/key；不需要第二套 fiber lifecycle。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：故障开关在 create 前失败；ambiguous 永不转人工。Rationale：避免演示注入制造双执行。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：不批准 Project Status/阻塞关系写入。Rationale：交付事实和规划接受独立。Date/Author：2026-10-27 +08 / spec reviewer。

## Idempotence and Recovery

安装事务相同键/内容读回已存 pair；用户禁用或冲突时失败，不重置。结果未知先 get setup 读回，不另生成 pair。key 解析失败保留 mount/context/工作树，让操作者修正宿主同一句柄后重试；轮换 key 不自动重签历史 run。重组/卸载遵循现有 lease 排空和 remote drain，所有在途会话操作受预算约束；已接纳 session 的不明结果先读取而非重启。

## Interfaces and Dependencies

新增 dependencies 仅为仓库已有 execution provider 包；不导入宿主 SDK 或新增 session 服务。Host adapter 的结构类型依据仓库已录制 API，create/prompt/inspect/list 是本批最小面，cancel 不支持。凭据必须由宿主 credentials 服务按固定句柄提供，无真实模型调用作为自动化测试前置。human wrapper 使用 Host 受限全局 resolveCredential 解析该固定句柄，不能误用仅绑定 GitHub account 的 credential closure；configuration 如保存句柄，必须通过该 catalog schema 与精确 allowlist。

交付者最终 push 后回读 head/base/checks/issue 关联/所有 review threads，当前 head 验证通过才 ready；本计划不授权合并。其他两个 lane 合入前，集成人验证映射重组期间 Start Work 的 lease 不丢、重组后执行角色/稳定 key 不变、卸载先 drain 再关 Storage。

## Outcomes & Retrospective

2026-10-27 Batch 2 当前修复结果：F411-1 的真实 Host/SQLite 回归由 RED 转 GREEN，重新安装使用新 key、实际生成两条新 binding。新增 unknown/pending 旧配置读数保护、activationError 恢复与旧读取版本保护。49 个相关测试与 typecheck 通过，9 个最终变异全部 KILLED。外部 APPROVE review id `5665061275` 由根会话回报，修复尚待另一评审者独立复评；本执行者未 commit/push 或操作 GitHub。下面的“独立验收通过”仅指修复前候选，Superseded by 本段对当前修复树的阶段判断（2026-10-27）。


最终本地结果：显式执行绑定、会话适配、稳定人工回退与安装重试（#359）已通过独立验收、修复复评与组合验证。历史阶段记录如下，其“待验收/未提交”描述仅指当时观察，Superseded by 本段（2026-10-27 17:03 +08）。

生产安装到 session/human 的本地闭环已实现，真实工作树、录制 raw 事件与 SQLite run 的验证完成。设置页只显示绑定配置启用，不宣称会话服务或密钥可用；完整独立验收、最终整理与发布回读尚未完成，PR 继续保持 draft。完成时只更新 TD-054 的执行条目与备用槽部分；GHES、多账号及其他条目不随之关闭。稳定 key 轮换与旧引用自动验证、Desktop/真实模型复验、持续 run 刷新仍按其独立需求维护；若出现新增维护债务，在 `docs/exec-plan/tech-debt-tracker.md` 写明影响及下一验收，不能把范围外承诺当已实现。

在检出 `test/iteration8-delivery-union` 的工作树根目录，`pnpm verify` 为 2143 个主测试与 7 个 MVP-0 测试通过，`pnpm run boundaries` 为 9 项通过；另完成跨能力的执行租约/映射重组及设置 mutation/单飞刷新组合观察。最终并集与实际宽测树的生产、测试和依赖字节一致，仅计划文档前移。单分支的具体测试与反例见 Progress 和 Validation and Acceptance。

PR #411 的最终发布状态必须重新回读，预期为当前 head/base 正确、全部检查通过、关闭引用完整且没有未处理评审线程，然后才能 ready；人类评审及合并由伙伴决定：

    gh pr view 411 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup
    gh pr checks 411 -R SingularityKChen/harness-projects

父项 #134 已以既有交付证据关闭；#124、#136、#226 仍保留，子能力交付不能替代其真实宿主与端到端走查。#143 的 Desktop/真实模型验收仍未由本批自动化测试覆盖。

## Bottom Change Note

2026-10-27 +08：双独立研究后系统审阅首次写入；选择唯一显式生产安装入口、保留 disabled 行、lazy service/secret、默认关闭且零外部调用的 start 失败开关，限定 800 行总闭环预算。

2026-10-27 +08：写后复核补齐 draft-first 与独立验收/最终回读顺序，移除审阅者本轮限制，明确 human 固定句柄不能误走 GitHub account credential closure。

2026-10-27 15:33 +08：完成写后复核并以实际本地时钟校正 Progress 时间；保留完整验收和当前未验证状态。

2026-10-27 +08：实现并串行集成共享接点，补 raw/receiver/reload、安装事务/冲突、稳定 secret 预算与重启、生产 apply 环境矩阵和 unknown 零人工执行反例；记录本地验证，保留独立验收 pending。

2026-10-27 +08：接收独立评审 R1，按真实 Host/SQLite 同页冲突恢复与移除重装反例先红后绿，修复窄 source intent 生命周期并覆盖未知/待定/畸形/读回/激活失败的同键恢复；保持独立复评 pending。

- 2026-10-27 17:03 +08：独立验收与组合验收后归档，保留历史观察并用发布回读命令代替易失 CI/ready 值；未改变 Project Status 或依赖关系。

- 2026-10-27：收到 F411-1 APPROVE 评审后的修复任务，在既有 completed 计划追加 Batch 2、三方案比较与窄验证；未另建计划。

- 2026-10-27：记录 Batch 2 的真实 RED/GREEN、49 窄测试、typecheck、9 项最终变异和待独立复评边界；原计划保持 completed 路径，不另建计划。
