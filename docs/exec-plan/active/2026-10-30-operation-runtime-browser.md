# 已发货操作运行时准入与生产浏览器验收 ExecPlan

> 状态：Active；创建：2026-10-30（Asia/Singapore）。
> 范围：Start Work 各外部步骤的当前权限门、安全恢复解释、唯一生产 browser carrier 与 #457 总验收。
> 关联：Closes #457；Refs #465、#468；只有 A、B 与本切片原验收全部成立才由关联 PR 关闭 #457，closingIssuesReferences 回读为准。
> 实施位置：所属工作树 `docs/exec-plan/active/2026-10-30-operation-runtime-browser.md`，遵循根 `PLANS.md`。

## Purpose / Big Picture

用户在同一工作区失去某个写权限时，只相应操作被禁用，允许的读和其它操作继续工作。直接发命令也在下一次 Provider 副作用之前拒绝。若前一步已 ack，界面和账本保留真实结果，停止后续禁止的写，绝不把外部资源删除或报成零副作用失败。

完整的生产浏览器证明同时覆盖 Planning 拒读与恢复、Delivery key 局部遮罩/离线保留、写门变化、旧响应及仍可用操作。测试与用户界面共享真实 Host、SQLite、typed remote、watch 和生产 client apply；浏览器桥不制造权限或内容。这个能力闭环使 #457 可以进入最终接受评审，不代表完整 #144 或 Gate R1 已通过。

## Context and Orientation

本切片 stack 在 Delivery B 上，B 依赖 Planning A，A 因真实准入反例已收敛为依赖 #204 的写前钩子。本切片复用同一个 BeforeExternalWrite 和唯一 durable intent，不新增平行授权/账本回调；A 的首次写前门在此扩展为逐步门，保持已经 ack 的资源事实。当前 A/B 正并行修订，接口稳定前只在不共享区域实现 production browser carrier，后续由协调者重放实际父 head 并验证。相关计划分别为同仓 active 或 completed 的 `2026-10-30-planning-runtime-access.md`、`2026-10-30-delivery-runtime-access.md`；前两层提供 current binding/key/target access、I/O epoch、query mask 和允许 explicit revalidation 的约束，不能预设尚未实现的函数名。

2026-10-30 在 `7907efbbdc5e35cc8ea4769c7067e885cec844e1` 调查：Start Work 的 route 初次通过后，`packages/core/src/git-provisioning.ts` 复用 frozen route；`packages/core/src/start-work.ts::startExecution` 解析执行门后又有本地 await，随后才调用 startRun。运行中权限变化需要在每次实际外部写之前复验，不能仅凭最初准入。

`packages/core/src/queries.ts::repositoryMetadata` 已逐仓库报告路由到的四个 Start Work key；`packages/ui-model/src/work-item-detail-view.ts::StartWorkRepository` 当前丢 reason；`packages/ui/src/start-work-section.ts` 只有泛化文案。现有 Host operation 声明在 `apps/harness-plugin/src/host-operations.ts::OPERATIONS`，cancel、planning-write、source-policy 不在 shipped entry 中。

现有 `tests/fixtures/execution-drawer-browser.mjs` 能启动浏览器页面，但它覆盖 controller.getEntity 并手工构造 baseline。#450/#451 仍不提供可假设存在的生产 carrier；本切片在这一个 fixture 上替换载体，保留生产 apply，不再复制第二套。

开始时在检出 `fix/operation-runtime-browser` 的工作树根回读 `git status --short --branch`、`git rev-parse HEAD origin/main`，记录实际 A/B 组合与当前已实现的 admission 接口。#204 是否合并另行回读；不得将其分支提交偷偷叠入本切片，或并行编辑同一 provision/startExecution 区域。若源码证明动态门真正依赖 #204 新接口，先明确记录阻塞与依赖，不假称现有主线已提供。

## Design / Spec

### 每步准入、拒绝观察与恢复

复用同一个 runtime owner，对实际选中的 binding/repository/key 在外部 I/O 之前重采样当前声明/permission，并复验当前 Planning 可见性及访问版本。路由冻结用于身份一致性，不能冻结权限；不重新选择另一个 provider 绕过 denial。四门仍按现有 START_WORK_ROUTE 组合，不能把本地 read-only 退成全工作区 unavailable。

覆盖 prepare 的 repository read、preflight、createBranch、createWorktree，以及主 execution.startRun 和真实 fallback.startRun。仅当步骤会实际调用该 key 时才检查；已经 ack 的步骤不需要重做来证明权利。外部失败以结构码反馈实际 binding/key/target，只有 PermissionDenied 表示写许可撤销；ordinary offline 仍是临时不可用，不能转换成永久拒权。

拒权在下一次写之前生效，拒绝优先于旧 Saved replay。已在途写的真实 ack 不抹掉：先按当前主线的唯一 ledger/step record 落真事实，再拒绝后续步骤。若执行不确定，保留 Unknown/对账，不以新 key 或另一个执行者重试。权限变化不改规划 Status，不改 persisted policy。

显式重新验证与实际写确认分开。沿既有 getStartWorkOptions/Start Work 表单接安全 validation/retry，不新增 deferred operation 名或 access dashboard；现有参数可在无发布兼容约束下有界调整。首批需在 A 的实际接口上固定消费者接线：普通 options 校验只能更新声明/许可证据和 retry 资格，静态 describe、另一个 key 的读成功绝不能冒充先前失败写已 ack。

对运行时实际 write denial 的显式重试是用户再次授权的原 intent，沿当前主线既有稳定幂等与对账路径；可做局部 probe admission，但不先把旧事实全局标为允许或 Saved。成功以该次写 ack/reconcile 为准；失败继续只禁该 key。capability 未实现和 policy 禁止不可被 retry 豁免。若现有 options/submit 无法表达一次 explicit retry，先记录最小参数契约并补判别测试，再实施；不引入后台自动写重试。

安全解释从 Host/Core 透传，点名 key、permission/capability/policy 层、仍可读的信息与 validation/retry 动作。透传安全固定原因，禁止 Provider 原始 message、SQL、secret 或本机路径。client 请求代次在 scope/access 变化后失效，旧 response 不能恢复按钮或覆盖新拒绝状态。

### 唯一生产 browser carrier

保留 fixture 的 SQLite、createHostComposition、installHostRemote 和现有 production client apply。HTTP unary 桥从 OPERATIONS 的 unary 声明推导，转调真实 installed.service，不能手工维护另一 operation 表或 controller proxy。未知 operation、stream 名冒充 unary、未知字段必须继续拒绝。

browser `$stream` 消费服务端真实 `host.watch` 帧：baseline/delta/metadata/gap 原样传递，客户端现有同步监督者负责 gap 重开。桥只赋输送 generation 和转发 accept/abort，不生成业务内容、capabilities 或同 revision baseline。restart、disconnect、dispose 均正常释放 host stream，不能留下挂起响应或多 scheduler。

控制端仅作用于 mounted Provider fault/permission、hold/release 真 Provider Promise、可重复的现有定时 tick；不得覆盖 controller.getEntity、baseline、wire metadata 或 client store。为执行状态保留原先非权限 fixture 功能时，明确那是既有测试 seam，不能用于本任务 authority proof。旧 visibility 操作迁移为真实 Planning Provider 行级 redaction或源拒读，不保留平行假权限路径。

用同一 browser carrier 实际打开列表与 drawer，维持页面不 reload，跑完整矩阵：Planning denial/late success/recovery、Planning offline stale、Delivery pipeline/check 局部 denial、Delivery offline permitted stale、单写 key denial、direct command 新 key/旧 replay、部分 ack 后拒绝下一步、恢复。保留键盘/focus、status/retry 可达证据，且至少一个被允许的其它操作可继续。

浏览器场景必须可重复执行：测试模块导出步骤与断言，配合本机可用的 browser 自动化工具执行；记录启动命令、head、测试选择、DOM canary、观察结果与截图。Node 静态 HTML 或手工点击叙述不能单独冒称真实 browser。

## Global Constraints

文件集：`packages/core/src/runtime-access.ts`（仅已发货写观察/validation 接入）、`packages/core/src/git-provisioning.ts`、`packages/core/src/start-work.ts`（只接逐步门，协调 #204 共享片段）；必要 `packages/core/src/queries.ts`；`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host-operations.ts`（仅既有 options/submit 参数接线）；`packages/client/src/start-work.ts`；`packages/ui-model/src/work-item-detail-view.ts`；`packages/ui/src/start-work-section.ts`；新 `tests/integration/runtime-operation-access.test.js`；既有 `tests/contract/harness-host-operations.test.js`、`tests/integration/harness-plugin-runtime-access.test.js`、`tests/integration/harness-plugin-execution-drawer.test.js` 的必要断言；唯一 `tests/fixtures/execution-drawer-browser.mjs`；新 `tests/e2e/runtime-access-browser.test.js`；本计划及 `docs/README.md`。接口稳定后的具体差异先更新本节，禁止同 owner 区域并行写。

严格预算是非 docs A+D ≤799、docs ≤1299。预测：逐步门/观察 90–140、client/UI/options 40–70、确定性写/partial ack 测试 170–210、carrier 替换（删除也计）160–210、真实 browser 场景 80–100、现有断言20–40，总计560–770；该预测尚未准入，也不把 C 当作已经保证 <800。

先复用 shared seed、OPERATIONS 推导和参数化场景，并删除被替代假 authority；不维护旧实验兼容。若真实 skeleton/TDD diff 表明完整 C ≥800，自动将“已发货逐步门/安全恢复”和“生产 carrier/browser 总验收”再分为两个完整 PR，各有独立计划与证据，最后一个才关闭 #457。用户没有 PR 数量上限，无需为这种保留验收的拆分重复请求批准。

没有 data migration、自动删除、上游权限写、政策/规划事实写、全局权限平台或新 UI 页面。真实凭据不进入测试。不得把本地测试当 hosted CI、真实 GitHub 撤权或人类 UAT。

## Plan of Work

### Concrete Steps

### Batch 1 · 接口与红测试准入

最小闭环是每一真实外部步骤的撤权失败可重复。主文件为新 `runtime-operation-access.test.js`。在实际 A/B 基线上复用已有 ledger/ack fixture，deferred 控制：准入后首写前撤权、branch ack 后 worktree 拒绝、worktree ack 后 execution 拒绝、主执行/人工 fallback 分别拒绝、旧 saved replay、新显式 retry 恢复。验证其它 key/仓库仍可用及 deferred Host 操作零副作用拒绝。

在 `fix/operation-runtime-browser` 工作树根运行：

    pnpm test:file tests/integration/runtime-operation-access.test.js tests/contract/harness-host-operations.test.js

期望写门用例先红在真实副作用计数/错误成功，而不是无效 seed；固定 A 与当前 admission 消费者接口及预算，不能先盲改共享算法。回滚为本批测试与接口原型，无资源删除。

### Batch 2 · 逐步门与恢复交互

最小闭环是所有已发货 write path 在当前权限下执行或诚实拒绝。主文件为 `git-provisioning.ts`、`start-work.ts`、`start-work-section.ts`。每次外部写前复验，失败观察只更新实际 key；复用当前 ack/Unknown，不加第二 ledger。接线安全理由和显式 validation/retry，旧 response 不恢复资格。

在同一工作树根运行：

    pnpm test:file tests/integration/runtime-operation-access.test.js tests/integration/start-work-sqlite-registration.test.js tests/e2e/start-work.test.js tests/integration/harness-plugin-runtime-access.test.js
    pnpm run typecheck
    pnpm run boundaries

期望所有控制窗口中禁止的下一步调用为零，已经 ack 的结果保留，重试不重复资源、不冒报 Saved。隔离负控去掉一步动态门必须使对应计数用例红；恢复后全绿。回滚本批 coherence 变更，A/B 仍可验收。

### Batch 3 · 替换唯一 carrier 并跑真浏览器

最小闭环是同一 fixture 可重复展示 A/B/本切片产品结果。主文件为 `execution-drawer-browser.mjs` 与新 `runtime-access-browser.test.js`。先替换合成 baseline/visibility 为真实 watch/Provider 控制，再保持现有 execution drawer 测试，并实际浏览器跑 Design 全矩阵；补 stream abort/restart 与 late resolve/reject 断言。

在同一工作树根运行：

    pnpm test:file tests/integration/harness-plugin-execution-drawer.test.js tests/integration/harness-plugin-runtime-access.test.js tests/e2e/runtime-access-browser.test.js
    node tests/fixtures/execution-drawer-browser.mjs

第一条执行可重复场景的 Node/桥契约，不能替代 browser。第二条期望打印 localhost 地址并保持服务；在可用真实 browser 工具打开该地址，运行场景模块导出的相同步骤。实施者须把实际 browser 工具入口、命令/参数及结果写入本节，缺浏览器执行证据则本批未完成。中止后 fixture 应关闭全部 stream/SQLite/HTTP。

隔离负控取消真实 query mask 或 epoch fence，实际 browser 的同 canary/late-response 场景应失败；恢复并重跑。不能用只隐藏按钮的负控替代。回滚 fixture/test coherence，已存在 A/B 安全实现保留。

2026-10-30 第一阶段本地证据：在 `fix/operation-runtime-browser` 的 `2f04105` 上，仅修改 fixture、新增浏览器桥契约和导出场景，未进入 Core/UI 的并发区域。`pnpm test:file tests/e2e/runtime-access-browser.test.js` 先因真实 `/remote` 与 `/watch` 未实现而失败；替换后新三项桥契约、既有三项 drawer 正控与两项 runtime access 集成共 8/8 通过。新增 `getWorkspaceSetup` 的 `confirmed` 断言进一步复现旧 seed 缺真实 `projectNodeId` 导致页面困在 setup，已通过 SQLite `putBindingConfiguration` 和受信 fixture schema 补齐，未覆盖 Host setup 返回。运行命令使用仓库固定的 pnpm 10.28.2。

浏览器复现入口仍是 `node tests/fixtures/execution-drawer-browser.mjs`；页面挂载后 `window.fixture.command(action,value)` 仅控制 mounted Provider `fault`（`domain/kind/enabled`）、真实 Provider Promise 的 `hold`（`domain/method/enabled`）和 `release`。`inspect` 返回请求记录与活动 stream/held 计数；`status` 是既有非权限执行正控 seam。`window.fixture.remote` 是从 `OPERATIONS` 推导的全部 unary，HTTP `/remote` 以 `{name,input}` 转调真实 installed service，`/watch` 透传真实 installed watch。`tests/fixtures/runtime-access-browser-scenarios.mjs` 导出同页操作步骤与实际 DOM 文本断言，浏览器由协调者集中执行；目前真实浏览器矩阵仍待验证，不以 Node 通过替代。

### Batch 4 · 全问题收口

主文件为本计划与 docs 索引。在实际 stack base 上运行 narrow suite 后运行完整 verify；整理提交、五类发布面扫描、严格规模及最终远端 head/base/checks/issue/threads 回读。A/B 合并后才把 origin/main 当基线，未合并时写实际 parent branch 的可复制命令。

    pnpm verify
    node scripts/workflow-check.mjs
    git diff --numstat origin/main...HEAD
    git diff --check origin/main...HEAD

再对实际 base 运行 `node scripts/rule-checks.mjs disclosure <实际base>` 与 `size <实际base>`，独立累计 code/test/config/fixture A+D≤799/docs≤1299。原 #457 五条验收逐条映射 A/B/C 真实证据后，关联 PR 才可提出关闭；最终 push 后远端回读全绿才 ready，人类决定 merge。回滚 C 保留 A/B，组合回滚按依赖逆序。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 首写/逐步撤权 | direct 命令、已准入窗口、branch/worktree/execution/fallback 各窗口下一禁止调用为零 |
| 真实部分 ack | 保留已确认 branch/worktree、现有 ledger 与 Unknown 恢复；零资源删除、无假零副作用/Saved |
| 局部禁用 | 仅实际 binding/key/target 操作禁用，其它读/操作可用；capability/policy不能被重试绕过 |
| 恢复解释 | key/layer/remaining/retry 明确；describe/其它读不冒充write ack；显式原intent稳定幂等 |
| Host 缺席命令 | cancel/planning-write/source-policy descriptor 与未知 dispatch 均拒绝，无policy/数据库副作用 |
| 唯一生产链 | SQLite→Host→remote/watch→真实client apply→browser；Provider fault是唯一权限控制，无合成baseline/controller替身 |
| 跨域真实 browser | 全部 A/B/本切片矩阵、同页面late成功/失败、恢复、keyboard/status/allowed operation及隔离负控 |
| 总验收 | #457每条原验收有真实证据，local/hosted/UAT边界清楚，严格规模与远端回读通过 |

## Progress

- [x] 2026-10-30（Asia/Singapore）：独立检查步骤门、发货 operation 表和现有 browser 夹具，建立候选计划。
- [ ] 确认 A/B 和当前主线接口，落盘本任务 active plan、冻结与 #204 共享片段的串行 ownership 及预算。
- [ ] Batch 1：红测试与最小消费者接线。
- [ ] Batch 2：逐步门、部分ack、局部恢复与负控。
- [ ] Batch 3：唯一生产carrier、真实browser全矩阵与负控。
  - 2026-10-30：第一阶段 carrier 替换及 Node 8/8 通过，真实 setup seed 缺口已按有效 RED→GREEN 修复；等待实际 A/B 父层接口与协调者浏览器证据。
- [ ] Batch 4：全问题验收、发布面、严格规模、远端回读与ready。

## Surprises & Discoveries

既有 frozen route 同时携初始 capability 快照，故其身份稳定性不证明当前授权；Execution resolve 后仍有 await，门必须贴实际副作用。已有 client `StartWorkResult` 丢弃 error，泛化“失败可重试”不能完成 key/layer 解释。

既有 browser `$stream` 将手工 baseline 包装为新 generation，controller visibility 也被覆盖；这只证明展示守卫，不证明生产权限。替换会同时计删除与新增，C 的规模风险主要在此，必须保留实际 diff 准入门。

实际浏览器首先暴露旧 fixture 虽有投影但没有持久 `BindingConfiguration.projectNodeId`，导致 Host 真实 setup 状态为 `degraded`，页面无法进入列表。直接 unary/watch 契约此前未覆盖 setup 准入，新增真实 setup 断言后修复 seed；不能从 baseline 含业务行推断生产页面可达。

## Decision Log

- Decision：把 C 定义为已发货操作准入与生产浏览器接受闭环，只 stack A/B，与 #204 共享片段串行整合。
  Rationale：不拆连续权限算法，又将原 B 超预算半径收敛到独立可验证交付。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。
- Decision：write denial 恢复须区分 retry资格与外部ack，采用显式原intent，不靠静态describe清掉真实确认责任。
  Rationale：客户端不能先显示Saved，安全读的成功不能证明写操作发生。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。

## Idempotence and Recovery

重复校验只更新对应目标证据，不触发写；重复显式写意图沿当前主线原幂等/对账。已 ack 资源保留，Unknown 不自动起第二个执行者；旧 epoch response 不能改变新 access 或 UI。

fixture 仅创建任务临时 SQLite/root，close 重复安全；发生失败先 abort stream、release held Provider 再关闭，不清理用户库。负控在隔离副本运行并恢复。回滚不修改 upstream permission、凭据或 persisted policy；回退本切片会重新暴露逐步权限窗口，须记录该风险。

## Interfaces and Dependencies

Node ≥22、pnpm、现有 fake/SQLite、esbuild、真实本机 browser 工具，无真实平台凭据。A/B 提供权限拥有者和目标 metadata；admission/ledger/ack 恢复复用实际主线，不依赖 #204 尚未合并的新 hook。consumer 函数名尚不是已实现事实，首批以实际源码固定并更新 living plan。

OPERATIONS 是唯一声明，HTTP bridge 从它推导 unary；stream 直接转发 Host watch。#450/#451 和 UI detail/forms 不作为前提。未知真实浏览器工具不可伪造成功；只允许在工具确实不可用时记阻塞，Node绿不能关闭总验收。

当前不接受技术债延期；若为规模拆 C，应建立下一份独立计划，保留 #457 open。确实接受的后续维护债按 `docs/exec-plan/tech-debt-tracker.md` 登记，不得把必要权限/browser证据记为“已接受延期”。

## Outcomes & Retrospective

当前完成独立计划评审，产品尚未实施，真实 browser 尚未执行，预算是预测。完成后记录实际A/B组合及与#204最终组合验证、命令与browser证据、负控、规模及偏差；只有原#457全部成立才提出关闭，R1和完整#144不在关闭声明内。

### Artifacts and Notes

原始日志、截图和负控只保存在任务运行态目录；本计划维护真实命令、分支、head 和结果。

## Bottom Change Note

- 2026-10-30（Asia/Singapore）：初版；分离完整Delivery读侧后，集中已发货逐步写门、诚实恢复与单carrier真实browser总验收，允许规模事实推动额外完整切片而不减验收。

Change Note (2026-10-30 SGT)：按实际独立反例更新依赖链为 #204→Planning→Delivery→本切片；保留完整 #457 验收，先在不共享区域改唯一 production browser carrier，实际接口稳定后再接逐步权限。A 发现未发货 Core writePlanningStatus 在 redaction 持久失败时未读 runtime 门，本切片需证实 Host allowlist 继续拒绝并评估最小 Core 门，不声称父范围提前完成。

Change Note (2026-10-30 SGT)：记录第一阶段真实 Host carrier 的 RED→GREEN、8/8 本地验证、真实浏览器发现的 setup seed 反例及修复；导出同页场景与 Provider 控制接口，浏览器总验收和逐步门保持未完成。
