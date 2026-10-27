# 规划一致快照与刷新确认 ExecPlan

> 状态：Completed（本地能力验收完成；发布门禁按下列命令回读）
> 创建：2026-10-27（Asia/Singapore）
> 范围：#361 + #360，一个从手动刷新到一致确认快照的能力闭环
> 规范：根 `PLANS.md`；分支 `fix/planning-snapshot`；基线观察 `2026-10-27 @ b164a211b0b0d9669724dc794c2fe32896c4eed0`

## Purpose / Big Picture

用户按“刷新规划”后立即看到进度，原内容继续可读；来源内容不变时，列表和已打开抽屉仍可看到“规划来源最后确认”时刻前进。读取失败保留最后确认内容和时间并标 stale。一次快照内的工作项、同步摘要、业务 revision 来自同一 Storage 一致读域，不能混用不同提交。

最小成功证据是 controller snapshot→metadata→client source→列表/抽屉的测试：成功不变刷新仅推进来源确认时刻、不推进业务 revision；双击仅一次读取；失败保留内容并 stale。#361 的一致读和 #360 的可见反馈共用同一合同、一次验收和一次回滚，故一个 PR 同时 `Closes #361` 与 `Closes #360`，不拆成伪独立 UI。

主控在 2026-10-27 15:31 +08 完成纯跟踪项 #134 的证据评论与关闭，报告回读 CLOSED 且 Project Status 保持 Todo；这是父项跟踪清理，不是本 PR 实现证据。#226 / #124 还需 clean-profile 安装、完整 steps 1–5、transport 断开重连等观察；本 PR 不自动关闭父项，也不以测试全绿替代 #143 或 R1。

## Context and Orientation

事实：`packages/core/src/queries.ts::listPlanningItems` 分别读取 summary、projections 与逐项 identity；`packages/controller/src/queries.ts::snapshot` 又取独立 revision 和 summary。这些 await 之间可提交新的规划状态。失败和不变对账并不推进业务 revision，因此 revision 前后双读相等也不能证明一致。

事实：`packages/core/src/bootstrap.ts` 已把 projection/revision/sync/reconcile cursor 在同一写事务提交；内容不变只推进 `lastReconciledAt`。`Storage.transaction` 已存在：SQLite 在同队列持有 BEGIN IMMEDIATE 到结算，Fake 在串行队列中克隆一致 draft；无需新增端口或迁移。事务内必须只用 tx，根 Storage 的队列调用会自等。

事实：controller watch 已按整个 source signature 发布同 revision metadata。`packages/client/src/workspace-read.ts` 的 lastUpdatedAt 是“客户端接受当前帧的时刻”，不是 Provider 对账时刻；TD-032 已指定 fresh 且 reconciledAt 前进时允许 metadata 推进接收确认。UI-model 有 refreshing/stale 派生，但 `WorkItemApp` 目前写死 refreshing=false。现有 setup `refresh(true)` 会把重复请求链到下一轮，不满足 UI 单飞要求。

上游依据：issues #361/#360 全部六条 AC、TD-024/TD-032、ADR-0012、`docs/product/vertical-path.md` steps 3–5。两个独立研究者分别分析了专用 Storage 聚合口与现有 transaction；本作者用 First Principles 的原子性反例及 Qian 的按钮→来源→反馈闭环审阅，选 transaction，并补来源作用域、失败恢复和晚响应判据。

假设：当前工作区规模下短本地只读事务的写槽占用可接受；没有性能测量支持新只读端口。主要风险是伪造“已确认”或同帧撕裂，而不是按钮可否触发 RPC。

## Design / Spec

Core 新增 `getPlanningSnapshot(): Promise<{views, sync, revision}>`。仅一次 `storage.transaction(async tx => ...)` 中读取当前 projections、其 primary identities、当前 Planning binding 的 sync cursor/成功 round、workspace reconcile cursor 与 currentRevision，再构造 views 和同一个 summary。helper 显式接收 `StorageTransaction` 所需读面，不用 `as CoreContext` 假装 tx 有 transaction。事务纯本地读取，零 Provider IO、零根 Storage 调用、零嵌套事务。

“一次 storage read”指一个原子读取作用域，允许作用域内多个 SELECT；不是新端口或单条 SQL。SQLite 和 Fake 现有实现均具隔离机制，必须用受控 interleave 测试验证调用路径确实用了它。`unavailableCore` 补空 views、revision=0、degraded/stale summary，未配置 Host 仍可用。

Controller snapshot 只从该 triple 生成 entities/source/revision；不得再拼接 getPlanningSync 或独立 revision callback。为减少无关公共调用迁移，可保留旧 `ControllerOptions.workspaceRevision` 参数并标 deprecated，但 snapshot 不调用也不采信它；测试传一个会抛错/伪 revision 的 callback，结果仍以 Core 为准。workspace/capabilities/repository metadata 仍按当前组合单独读取，本批承诺的是 Planning triple 一致性，不宣称 registry/config 的全系统原子快照。

`SyncSummary` 新增可省略 `reconciledAt`，唯一来源是已成功提交 reconcile cursor 的 lastReconciledAt；只放整表 header.source，不复制到每行 source。不变成功推进它但业务 revision/实体数不变；失败保留最近成功时间且 stale；从未成功时省略，UI 显示未知。当前 reconcile cursor 只有 workspace 键，因此必须当前 binding 存在成功 committed round 才采纳；旧 workspace cursor + 新 binding 没有成功 round 时不能暴露旧时刻。当前单 Planning scope 不支持的同 binding 项目切换归 #202，不能声称这一守卫解决了通用换源。

wire 和 client header 校验接受省略或合法 ISO8601 时刻，拒绝 null/数字/坏格式/不可解析及不可能日历值；校验在更新 store、head、clock 之前完成。复用已有时间校验机制并补严格日历判别，不靠 Date.parse 单独放过 2 月 30 日。sourceSignature 自然捕获时间变化，同 revision 发 metadata，业务 signature 不变，不发 fake delta/upsert。

Client 显式保存 Host `reconciledAt` 供 UI 展示。整表 fresh 且该时刻较前值前进时，按 TD-032 让 lastUpdatedAt 取接受帧时的 client clock；lastUpdatedAt 仍是接收时刻，不能冒充来源时刻。重复 metadata、纯改名/能力变化、降级、idle poll 不推进；来源 scope 变化不得从旧 source 继承确认。partial/degraded summary 可以携带旧已成功时刻，但不能制造新的成功确认。

新增小型 `PlanningRefreshSource`：只保存 pending、安全 error 与当前 workspace scope；refresh() 在首次调用同步占据一个 Promise 槽，同 scope 在途重复调用原样返回它，finally 清理。只调用正式 refreshPlanning，再让既有 watch/source 接收结果，不 reconnect、不创建第二份列表缓存、不把 command result 当列表。来源时刻到达由 metadata 负责；RPC 完成时不能本地造时刻。未连接/无读能力/进行中禁用按钮，保留 accessible busy/status。

列表和抽屉从同一 WorkspaceRead 派生最后确认时刻及刷新状态，pending 仍显示旧内容并 stale。失败发布安全错误且保留内容/时间；即使 transport 失败但尚无 Host degraded 帧，本地 failed 状态也必须使展示 stale。后续成功清 error；权限阻断仍遵守既有不借缓存/redaction 门。dispose/换 scope 的晚成功/晚拒绝不能更新旧 UI。setup 的读取设置动作不改成第二个列表刷新器；如有同时可触发的规划刷新入口，必须注入同一 refresh source，不能各自排队第二轮。

比较方案：Promise.all 或 revision 重试没有一致性；专用 Storage 聚合口新增两个实现/合同而无性能证据；UI 本地 Date.now 不代表来源确认；reconnect 拉基线增加 #218 迟到基线竞争。本方案复用事务、metadata 和 source，保留单一权威链。

## Global Constraints

保留系统不变量；不改 scheduler、Provider mutation、Planning Status、Storage 端口/DDL、#218 迟到 baseline/generation 协议或 #202 换源模型。Host 确认时间不是硬件时间/实时性承诺。事务内无外部 IO，避免扩大 writer 锁占用。

允许文件集合仅在此声明：新增 `packages/client/src/planning-refresh.ts`、`tests/integration/planning-snapshot.test.js`、`tests/contract/ui-planning-refresh.test.js`、`tests/integration/harness-plugin-planning-refresh-ui.test.js`；修改 `packages/client/src/workspace-setup.ts`、`packages/core/src/queries.ts`、`packages/core/src/projection.ts`、`packages/core/src/context.ts`、`packages/core/src/index.ts`、`packages/controller/src/queries.ts`、`packages/controller/src/index.ts`、`packages/controller/src/wire.ts`、`packages/client/src/workspace-read.ts`、`packages/client/src/sync.ts`、`packages/client/src/index.ts`、`packages/ui-model/src/work-item-list-view.ts`、`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-list.ts`、`packages/ui/src/work-item-detail.ts`、`apps/harness-plugin/src/client.ts`、`packages/ui/src/workspace-setup.ts`、`tests/integration/sync-revision-freshness.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/e2e/client-sync.test.js`、`tests/contract/ui-work-item-app.test.js`、`tests/contract/ui-work-item-list-view.test.js`、`tests/contract/ui-work-item-detail-view.test.js`、`tests/contract/ui-work-item-list-browser.test.js`、`tests/contract/ui-model-presentation.test.js`、`tests/e2e/chain-bootstrap.test.js`、`tests/integration/github-projects-bootstrap.test.js`、`tests/integration/planning-refresh-scheduler.test.js`、`tests/integration/planning-round-order.test.js`、`tests/integration/workspace-sync-scope.test.js`、`docs/review/pr-412-mmp-review.md`、本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`。既有 wire/sync 深比较在这些回归内更新；如真实 typecheck 暴露其他旧 mock 需要新增 query，先明确列入此集合，不能无记录扩散。

初估 Core/controller/client read 150–200、UI/action/全部接点 130–170、判别测试及旧断言 300–380，合计 580–750，预留至 790；code+tests changed lines ≤800、docs ≤1300。预算包含新旧 fixture/断言/接点；不新增 Storage contract 或复制 provider 夹具。超过 800 时保持全部六条 AC 与反例，先删除非闭环重构/复用夹具；仍不满足则先更新本计划回退为 #361→#360 真依赖 stack，不削测试、不拆成生产缺合同的独立 UI PR。

refresh owner 独占 Core query/projection、controller snapshot/wire、client read/sync、UI 时间派生/刷新组件；共享 client.ts、setup UI、index 与文档索引由主控指定唯一集成人串行落 patch，mapping/execution owner 不写这些刷新单元。保留 deprecated callback 使本 lane 无需修改 host-composition。索引在 `2026-10-22-host-planning-refresh` anchor 后插入；技术债只处理 TD-024/032 的实际解决范围，#218/#202 未解决部分显式保留。

不改 Project Status、blocked-by/blocking，不以 CI/PR 自动推进规划接受。实际完成后迁 completed 更新索引；不自行合并。

## Plan of Work

### Batch 1 · 原子读取到可见刷新确认

最小闭环：手动按钮 → 一轮 Host 读取 → 原子 Planning triple/成功时刻 → 同 revision metadata → client → 列表/抽屉。主文件为 Core queries、controller wire、client planning-refresh 与 WorkItemApp；完整集合见 `Global Constraints`。

1. 以本计划完成独立审阅后，先做 plan commit 和 draft PR，关联同仓 issues #361/#360 并双向回读 base/head/draft、closingIssuesReferences 与文件范围；未有实现时不宣称 AC 完成。然后才开始 RED。
2. 在新 snapshot 测试中对 Fake/SQLite 参数化：包装事务读面在首项读取后发出一个根 Storage 写事务，写入“新 projection/identity/redaction + degraded sync + 新 revision”；读测试先释放 latch，再在读作用域外 await writer，不能在读事务内等待被阻塞写者。旧路径应可撕裂，新路径只能全旧或全新且 writer 随后提交。另测 snapshot 不调用旧 revision callback。
3. 实现 tx snapshot、summary 时间、wire/client strict validation、同 revision metadata 时间路径；先跑对应窄测试。补旧 cursor/新 binding 未成功、失败保留时间、空集、坏时间不半更新、重复 metadata/断线重连时钟语义。
4. 实现单一 refresh source、UI button/busy/error 和来源确认时刻。controller snapshot 驱动内容不变刷新，列表/抽屉同时前进；同 tick 双击返回一个 Promise且一轮 Provider read，下一次独立点击才再读；晚响应/dispose/权限门不污染旧 UI。
5. 集成人落共享 patch，跑以下验证；独立验收者检查六条 AC、反例与语义后做必要重构并重跑受影响验证。更新证据/债务，整理初始计划和最终实现为一个能力整合 commit `fix(planning): 保证快照一致并显示刷新确认`，末尾 `Closes #361` 与 `Closes #360`。
6. 最终 push 后回读当前 head/base/checks/全部 review threads/双 issue 关联，当前 head 的检查与验收通过才 ready，并请求人类 review；不自行合并。已推分支若需整理历史，先 backup ref 并按 expert 精确 lease 流程。

以下命令在检出 `fix/planning-snapshot` 的工作树根运行：

    pnpm test:file tests/integration/planning-snapshot.test.js tests/integration/sync-revision-freshness.test.js tests/e2e/workspace-read-assembly.test.js tests/e2e/client-sync.test.js
    pnpm test:file tests/contract/ui-planning-refresh.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-list-browser.test.js
    pnpm typecheck
    pnpm run boundaries
    pnpm verify
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望双 Storage interleave、wire/client、真实组件路径全 pass；typecheck/boundary/verify pass；disclosure 无命中；机械规模及本批更严格 800/1300 通过；diff-check 无输出。scout 基线 verify 2086 + 7 由主控跑过，不代表新增行为已通过。回滚点为整个能力 commit；旧 reconcile cursor 保留，无数据迁移或补偿写。

### Batch 2 · MMP 评审 P2 修复

最小闭环：修复 review `5665075601` 的 F1/F2，列表与已打开抽屉在新的 Host 确认后退出交互失败，部分提交仍由 Host 的整表/行级 freshness 展示。主文件是 `packages/client/src/planning-refresh.ts` 与既有 `tests/integration/harness-plugin-planning-refresh-ui.test.js`；完整允许集合见 `Global Constraints`。

根因：刷新器把只表示交互失败的 error 当作永久事实，source 订阅只处理换 scope；响应解析又把所有 error 都当作没有提交，混淆 `ok=true` 部分提交与 `ok=false` 整轮失败。

方案比较：A）任何 source publish 就清错，最短但旧 fresh/改名/降级会假恢复，拒绝；B）UI 自行用 freshness 忽略 error，会把第二套确认裁决放到 renderer，拒绝；C）refresh source 记录失败时已见来源时刻，只在同 scope、已连接、可读、Host fresh 且来源时刻严格前进时清错，并严格区分合法完整成功、合法部分成功与失败，选择 C。部分提交的响应只结束交互，绝不本地更新列表/时间；watch 决定整表 degraded 与可见行 fresh。

步骤：先 RED 新增真实 controller→sync→列表/抽屉的后台恢复和部分成功用例；负例固定旧 fresh、改名、旧时间、pending、降级、断连、非法响应与真正失败；再实现最小修复。验证为 `node --test --test-timeout=120000 tests/integration/harness-plugin-planning-refresh-ui.test.js`，预期新增主用例先 RED 后全绿；随后相关 41 项基线与 typecheck，最后最终产品树整表 mutation（必须 killedBy）。恢复路径：回退本批刷新器和测试改动，保留原 PR 功能；不改 Storage、Provider 或 watch 协议。

## Validation and Acceptance

| # | 验收项与反例 | 判定证据 |
|---|---|---|
| 361-1 | views/summary/revision 同一读域，identity/redaction 不撕裂 | Fake + SQLite latch interleave，全旧或全新；writer 之后成功提交；旧 revision callback 零调用 |
| 361-2 | summary 携带最后成功 reconcile 时间，不变刷新不推进业务 revision | Core/controller/watch/client 集成；实体数与业务签名不变、reconciledAt 前进 |
| 361-3 | wire 接受可省略合法时间，拒绝畸形时间且无半帧 | null/数字/坏格式/不可解析/不可能日期矩阵，store/head/clock 均未变 |
| 360-1 | 不变手动刷新后列表与已开抽屉可见最后确认时间前进 | 从真实 controller snapshot 驱动 client source + component/browser 路径，非本地 clock mock 冒充来源 |
| 360-2 | 失败保留最后内容/时间并 stale，后续成功清错 | component + Host RPC/metadata 故障路径；空集同样有确认时间，权限门保持 |
| 360-3 | 同一在途两次刷新只一次读，进度同步可见 | 同 tick double invoke 返回同 Promise，RPC/Provider read 计数1，下一次点击计数2 |
| F1 | 旧 workspace cursor 不冒充未成功新 binding 确认 | 新绑定无 committed round 时 reconciledAt 省略；旧时刻不显示 |
| F2 | 重复 metadata/idle/降级/换 scope/晚响应不造时间 | client 接受前验证、refresh dispose/scope 与重连回归 |

### Batch 2 修复验收证据

在检出 `fix/planning-snapshot`、基础 head `2bc7db58b2bba70a9bf1ca3ac71958618f45495d` 加本批未提交修复的工作树根目录执行：

```sh
node --test --test-timeout=120000 tests/integration/harness-plugin-planning-refresh-ui.test.js
node --test --test-timeout=120000 tests/integration/planning-snapshot.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/contract/ui-planning-refresh.test.js tests/e2e/workspace-read-assembly.test.js tests/contract/ui-workspace-setup.test.js tests/integration/planning-refresh-scheduler.test.js
node_modules/.bin/tsc --noEmit
```

RED：第一条在改实现前为 13 pass / 4 fail，分别是后台同源确认、在途新确认后的晚失败、部分成功与畸形 ok=true 响应，失败均为预期断言。GREEN：最小实现后 17/17；补充同 scope reconnect 变体后，第二条为 **80/80 pass**、typecheck exit 0。

最终产品树一次整表变异由 `node scripts/review-mutate.mjs /dev/stdin` 执行，48 项基线在施加前与还原后均绿，**11/11 KILLED、exit 0**，每项均命中 `killedBy`。M1–M4 保持原子快照/时间透传/单飞/时间校验；M5 关掉恢复、M6 放行相等旧时间、M7 放行 degraded、M8 忽略失败结算时刻、M9 拒绝部分提交、M10 跳过响应校验、M11 忽略旧 scope。完整可执行 spec 和归因见 `docs/review/pr-412-mmp-review.md` 的 Batch 2 节。

响应校验限定完整成功为合法 `local_only` flags、非负整数计数、ok=true/degraded=false/unanchored=0 且无 error；部分成功必须 degraded=true/unanchored>0，外层与内层一致的合法 permission_denied。没有本地更新时间或伪造 Saved；真正失败、旧确认、改名、降级、断连、无读能力、pending、scope/dispose fence 均有回归。独立复评、最终整合与远端 head/check/thread 回读由根会话继续，本批不宣称完成发布。

## Progress

- [x] (2026-10-27 15:33 +08) 读双独立研究、实际 Storage/queries/watch/client/UI，完成合 PR 因果与预算审阅。
- [x] (2026-10-27 15:33 +08) 写入统一 spec/plan，尚未实现或测试新增行为。
- [x] (2026-10-27 16:08 +08) Batch 1 的 plan commit 与 draft PR #412 已由主控建立并双向回读 #361/#360；未提前宣称 AC 接受。
- [x] (2026-10-27 16:08 +08) RED 复现 Fake/SQLite 旧行与新 revision 撕裂、旧 callback 被调用、UI 无刷新按钮、真实 local_only 响应被误拒及模态抽屉缺少可操作刷新入口。
- [x] (2026-10-27 16:08 +08) 实现原子 Planning triple、Host 确认时间、严格帧校验、单飞 source、列表与抽屉反馈；共享接点由唯一集成人顺序落地。
- [x] (2026-10-27 16:08 +08) 在 `fix/planning-snapshot` 检出运行主链窄回归 101 pass、旧夹具回归 91 pass、模态入口回归 11 pass、typecheck、boundaries 9 pass；最终 `pnpm verify` exit 0（2095 + MVP 7 pass，0 fail/cancel）。
- [x] (2026-10-27 +08) 独立验收发现两个 P2：同 tick dispose/scope 变化后旧微任务仍发 RPC；setup 的重复 reconcile 在单飞 source 上方排第二轮。已在正式测试复现 5 个 RED 场景并修复；实际 setup+planning-refresh 在无阻塞、读中、mutation 中均共享同一 Promise 和一轮 RPC，同步 pending 订阅也加入原任务。
- [x] (2026-10-27 +08) 修复轮窄回归 `pnpm test:file tests/integration/harness-plugin-planning-refresh-ui.test.js tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/contract/ui-planning-refresh.test.js tests/contract/ui-work-item-app.test.js` 为 66 pass；`pnpm typecheck` exit 0；`pnpm run boundaries` 9 pass。前述 2095 + 7 为修复前整体验证，不冒充本轮宽测；按 scoped 复评要求不重复宽测。
- [x] (2026-10-27 +08) fix1 scoped 复评确认原 R1/R2 已处理，但发现后来加入的 mutation 被 queued reconcile 越过；新增 queued / in-read 两个 latch 用例复现「RPC=1、pending=false、bind 成功但 UI unbound」，在 start 前重新等待当前 mutation 后转绿；另保留已开始 reconcile read 时后来 mutation 的 revision 归属验证。
- [x] (2026-10-27 +08) fix2 的同一 scoped 命令为 69 pass；typecheck exit 0；boundaries 9 pass。独立原时序 probe 在 mutation latch 保持时只记 connect-start / pending=true，全部结算后为 confirmed，且唯一 refresh 在 bind/read 之后。
- [x] (2026-10-27 17:03 +08) 原独立验收者已逐条复评通过；所有本批发现均已修复，未以作者自审替代独立验收。
- [x] (2026-10-27 17:03 +08) 三能力本地并集验收通过，完成归档和索引；发布与 ready 的易失状态由本计划末尾的 GitHub 命令控制，不把工程验收当作人类规划接受。

- [x] (2026-10-27 +08) Batch 2 已完成 RED→GREEN、80 项相关回归与 typecheck；最终产品树11项变异全部归因 KILLED，已逐字还原。
- [x] 2026-10-27：Batch 2 修复已由未参与实现的子评审独立复评，最终组合2157+7、pack与28项变异通过；当前证据见 `docs/review/pr-412-mmp-review.md` 和批次记录。

## Surprises & Discoveries

现有 Storage transaction 已提供所需隔离；新增聚合口会把 Core 展示需要扩散到两个存储实现。业务 revision 不覆盖失败与不变 reconcile，所以 revision 重试方案不可判别；同 revision metadata 已存在，时间透传无需新 watch 协议。setup refresh 的链式重试不是 single-flight，不能直接复用。

实施发现：controller 的成功刷新命令是 `local_only`，不能把 `authoritative=false` 当作失败；模态抽屉令外层按钮 inert，所以抽屉内也消费同一刷新动作。旧 round-order 根读探针必须在失败结算结束后恢复，避免新增成功轮次查询误触 latch。确认时间只在实际前进时发 metadata，相关测试注入递增 Host clock，避免同毫秒重复成功造成偶发断言。

## Decision Log

- Decision：执行 review `5665075601` 的两个 P2 修复，采用 Batch 2 方案 C。Rationale：保留单一 Host 确认链和可判别失败，不把部分提交误报整轮失败。Date/Author：2026-10-27 / 本轮修复者。
- Decision：根会话已取得人类本次对 #410–#412 无 P0/P1 或仅有 P2/P3 时修复、独立复评、归档、整合及 rebase merge 的授权；本子任务只获刷新器/相关测试/本计划/评审文档写入权限，不 commit、push 或外部写入。Date/Author：2026-10-27 / 根会话分派。

- Decision：#361/#360 合为一个 PR，选择现有 transaction 读作用域。Rationale：同一用户闭环与同一 wire 合同可独立验收/回滚，预算可控；不新增端口。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：保留但忽略 deprecated revision callback；一致边界为 Planning triple。Rationale：去掉第二 revision 权威，不为配置/registry 全局一致性扩张本批。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：Host reconciledAt 与 client lastUpdatedAt 分开。Rationale：遵守 TD-032，客户端接收时刻不能替代来源成功确认。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：不授权 Project Status 或阻塞关系变更。Rationale：工程验证不是规划接受。Date/Author：2026-10-27 +08 / spec reviewer。

## Idempotence and Recovery

重复 refresh 在途共享 Promise；setup 的 reconcile 等待现有读取或 mutation 时也只有一个任务槽，启动前再等待此间加入的当前 mutation；完成后新的显式点击才发新请求。尚未 dispatch 的规划请求在调用端口前复核 dispose、epoch 与 scope，失效时不发送；已开始 IO 的晚结果继续受发布 fence 约束。失败仅使展示 stale，不清缓存或成功 cursor；下一成功刷新通过原 watch 恢复。事务读取抛错整体结束，writer 队列继续，不保留 tx 引用；测试 latch 必须 finally 释放，避免永久占写槽。回滚移除 UI/action/新 query 消费，保留已存在 reconcile 数据；旧帧没有新字段就显示未知。禁止为恢复而 reconnect、删除数据库、重置 revision 或制造客户端确认时刻。

## Interfaces and Dependencies

无需新增凭据、Provider API、Storage 合同或迁移；依赖已有 transaction、Core refreshPlanning、controller metadata/watch。新 query 是 Core→controller 唯一三元事实源；SourceMetadata 的新增字段可省略以兼容旧快照。WorkspaceSource/getSnapshot 保持不可变对象身份语义，refresh source 不存工作项副本。

与其他 lane 的组合验收由唯一集成人负责：mapping 重组后 refresh single-flight 正常；新执行安装不影响同 revision metadata；刷新/重组期间 lease、shutdown drain 顺序保持。真实 profile/模型/network-cut 走查留给所属 demo issue；本 PR 不自动替代它们。

## Outcomes & Retrospective

2026-10-27 MMP 修复收口：独立复评和最终重组已完成，未发现 P0/P1；本批产品与最终验证组合逐字一致。 当前产品复评160项、远端CI通过；仅有计划状态P3已机械更新，最终文档head仍须重新回读。 本段替代下列历史阶段的等待状态，不替代 #143 的真实宿主走查或人类规划接受。

Batch 2 本地修复已完成，等待独立复评。原独立验收“没有剩余发现”的范围是此前实现快照；本次 MMP 评审新增 F1/F2 并以新反例修复，原结论 Superseded by 本段与 Batch 2 修复验收证据（2026-10-27）。本批没有 commit、push、外部回复或 merge；不能把绿测试当作远端已更新。 此为历史阶段观察，Superseded by `docs/review/pr-412-mmp-review.md` 的最终独立复评与 `docs/review/2026-10-27-pr410-pr412-mmp-review.md` 的组合证据（2026-10-27）。


最终本地结果：一致规划快照、来源确认时间与可取消的单飞刷新（#361、#360）已通过独立验收、修复复评与组合验证。历史阶段记录如下，其“待验收/未提交”描述仅指当时观察，Superseded by 本段（2026-10-27 17:03 +08）。

当前实现已通过本地完整验证，等待独立验收；不把实现与测试通过当成人类规划接受。TD-024/032 已记录实际实施进展，保留 Open 直到独立验收；#218 迟到基线与 #202 通用换源仍未解决。若实测短 transaction 阻塞不可接受，在 `docs/exec-plan/tech-debt-tracker.md` 记录负载、影响与专用 read transaction 的下一验收，不先引入推测优化。 此为历史阶段观察，Superseded by `docs/review/pr-412-mmp-review.md` 的最终独立复评与 `docs/review/2026-10-27-pr410-pr412-mmp-review.md` 的组合证据（2026-10-27）。

在检出 `test/iteration8-delivery-union` 的工作树根目录，`pnpm verify` 为 2143 个主测试与 7 个 MVP-0 测试通过，`pnpm run boundaries` 为 9 项通过；另完成跨能力的执行租约/映射重组及设置 mutation/单飞刷新组合观察。最终并集与实际宽测树的生产、测试和依赖字节一致，仅计划文档前移。单分支的具体测试与反例见 Progress 和 Validation and Acceptance。

PR #412 的最终发布状态必须重新回读，预期为当前 head/base 正确、全部检查通过、关闭引用完整且没有未处理评审线程，然后才能 ready；人类评审及合并由伙伴决定：

    gh pr view 412 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup
    gh pr checks 412 -R SingularityKChen/harness-projects

父项 #134 已以既有交付证据关闭；#124、#136、#226 仍保留，子能力交付不能替代其真实宿主与端到端走查。#143 的 Desktop/真实模型验收仍未由本批自动化测试覆盖。

## Bottom Change Note

2026-10-27 +08：双独立研究后系统审阅首次写入；把一致读、来源时间、metadata、单飞刷新和双视图反馈收敛成一个可回滚 PR，明确不削 AC 的 800 行预算与退回真 stack 条件。

2026-10-27 15:33 +08：完成写后复核并以实际本地时钟校正 Progress 时间；保留完整验收和当前未验证状态。

2026-10-27 +08：完整回归发现四处旧 SyncSummary / wire 字段面夹具深比较，已加入允许集合，仅更新来源确认字段断言；组合页无 refresh prop 时保留既有元素树形状。

2026-10-27 +08：新 summary 读取成功轮次后，旧 round-order 探针仍挂在根读取上并暂停查询自身；在失败结算断言前恢复原读函数，保留原有 root 零次与 tx 次数判据。

2026-10-27 +08：完整回归的 workspace-sync-scope 三处旧 summary 深比较同步承接确认时间，加入允许集合，保留工作区隔离全部判据。

2026-10-27 16:08 +08：实现与最终验证完成，写入真实 RED/GREEN、共享接点、旧夹具迁移与模态刷新自审结果；等待独立验收，不提交、不迁 completed。

2026-10-27 +08：独立验收指出两个 P2；新增同 tick dispatch 取消与真实 setup+planning-refresh 三种阻塞组合 RED，纳入 setup source 允许集，仅收敛 reconcile 共享任务与 dispatch fence。#202/#218 边界保持未解。

2026-10-27 +08：修复轮完成；发送前 fence 与 setup reconcile 共享等待任务通过 66 项 scoped 回归、typecheck 和 9 项 boundaries，保留独立 scoped 复评 pending，不提交或发布。

2026-10-27 +08：fix2 修复 scoped 复评新增的 P2-R3；只在 setup start 前重新等待当前 mutation，补 queued/in-read 两条 RED 与既已开始读取的代际回归，69 项 scoped 验证通过，等待同 reviewer 复评。

- 2026-10-27 17:03 +08：独立验收与组合验收后归档，保留历史观察并用发布回读命令代替易失 CI/ready 值；未改变 Project Status 或依赖关系。

- 2026-10-27：MMP 评审发现 F1/F2 后追加 Batch 2，记录根因、三方案取舍、RED/GREEN 与最终变异门；原能力计划保持 completed，本轮修复独立复评未完成。

- 2026-10-27：写入 Batch 2 的13/4 RED、80 GREEN、typecheck 与11项最终整表变异，明确独立复评仍未完成；未修改其他 PR 或公共索引。

- 2026-10-27：修复文档P3，原处收口Batch 2 Progress并为历史等待结论标注Superseded；独立复评与组合验证证据见对应review记录。
