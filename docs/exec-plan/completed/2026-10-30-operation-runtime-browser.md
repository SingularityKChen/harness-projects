# 已发货操作运行时准入与生产浏览器验收 ExecPlan

> 状态：Completed（2026-11-02 SGT，R11完整独立技术复评与具体1162预算通过；最终文档head CI/正式当前head批准及线程回读后Ready，不merge）。
> 范围：Start Work 各外部步骤的当前权限门、安全恢复解释、唯一生产 browser carrier 与 #457 总验收。
> 关联：Closes #457；Refs #465、#468；只有 A、B 与本切片原验收全部成立才由关联 PR 关闭 #457，closingIssuesReferences 回读为准。
> 实施位置：所属工作树 `docs/exec-plan/active/2026-10-30-operation-runtime-browser.md`，遵循根 `PLANS.md`。

## Purpose / Big Picture

用户在同一工作区失去某个写权限时，只相应操作被禁用，允许的读和其它操作继续工作。直接发命令也在下一次 Provider 副作用之前拒绝。若前一步已 ack，界面和账本保留真实结果，停止后续禁止的写，绝不把外部资源删除或报成零副作用失败。

完整的生产浏览器证明同时覆盖 Planning 拒读与恢复、Delivery key 局部遮罩/离线保留、写门变化、旧响应及仍可用操作。测试与用户界面共享真实 Host、SQLite、typed remote、watch 和生产 client apply；浏览器桥不制造权限或内容。这个能力闭环使 #457 可以进入最终接受评审，不代表完整 #144 或 Gate R1 已通过。

## Context and Orientation

本切片 stack 在 Delivery B 上，B 依赖 Planning A，A 因真实准入反例已收敛为依赖 #204 的写前钩子。本切片复用同一个 BeforeExternalWrite 和唯一 durable intent，不新增平行授权/账本回调；A 的首次写前门在此扩展为逐步门，保持已经 ack 的资源事实。已由协调者串行重放父层：B `f43efcd` 保留持久 read-health、scope proof、Storage ack 后发布、双 epoch、Host 返回前 fence 与 `accessVersion`。C 的操作证据沿同一个 runtime owner 的既有 epoch/token 发布，不增加第二授权源。相关计划分别为同仓 active 或 completed 的 `2026-10-30-planning-runtime-access.md`、`2026-10-30-delivery-runtime-access.md`；前两层提供 current binding/key/target access、I/O epoch、query mask 和允许 explicit revalidation 的约束，不能预设尚未实现的函数名。

2026-10-30 在 `7907efbbdc5e35cc8ea4769c7067e885cec844e1` 调查：Start Work 的 route 初次通过后，`packages/core/src/git-provisioning.ts` 复用 frozen route；`packages/core/src/start-work.ts::startExecution` 解析执行门后又有本地 await，随后才调用 startRun。运行中权限变化需要在每次实际外部写之前复验，不能仅凭最初准入。

`packages/core/src/queries.ts::repositoryMetadata` 已逐仓库报告路由到的四个 Start Work key；`packages/ui-model/src/work-item-detail-view.ts::StartWorkRepository` 初始丢 reason；`packages/ui/src/start-work-section.ts` 初始只有泛化文案，当前已接显式 validation 与安全原因。现有 Host operation 声明在 `apps/harness-plugin/src/host-operations.ts::OPERATIONS`，cancel、planning-write、source-policy 不在 shipped entry 中。

初始 `tests/fixtures/execution-drawer-browser.mjs` 通过 controller.getEntity 覆盖与手工 baseline 启动页面；当前已替换为 installed service/watch 与生产 apply。#450/#451 仍不提供可假设存在的生产 carrier；本切片在这一个 fixture 上替换载体，保留生产 apply，不再复制第二套。

开始时在检出 `fix/operation-runtime-browser` 的工作树根回读 `git status --short --branch`、`git rev-parse HEAD origin/main`，记录实际 A/B 组合与当前已实现的 admission 接口。已由协调者明确重放为 #204→Planning A→Delivery B→本切片，当时父层 `f43efcd`、C 第一阶段 `273ad88`（Superseded by Outcomes & Retrospective，2026-10-30）；前版父层 `a6477f2` 与 C `c11dbdd` 只用于历史证据。#204 是否合并另行回读；当前实际消费者只用 #204 的 `BeforeExternalWrite`、`beforeExternal` 与已有 `writeReceipt`，没有平行 hook 或第二账本。

## Design / Spec

### R472-U1 修复规格（2026-10-30）

目标身份变化可清空表单命令状态；同 workspace/workItem 的访问 metadata 变化只撤销 options/validation，不抹去 in-flight、Unknown、Pending 或已确认 partial ack。命令 completion 与 access/options 使用不同失效边界：旧 options 或旧成功 completion 不能恢复新拒绝后的写资格，真正 target 变化仍拒绝旧结果。保留现 client 原键、Core ledger 与真实 ack，不把修复缩成保留一段文字。先扩正规 UI 用例覆盖在途、Unknown/Pending、partial ack 与迟到 options；有效 RED 后作最小实现。

### 每步准入、拒绝观察与恢复

复用同一个 runtime owner，对实际选中的 binding/repository/key 在外部 I/O 之前重采样当前声明/permission，并复验当前 Planning 可见性及访问版本。路由冻结用于身份一致性，不能冻结权限；不重新选择另一个 provider 绕过 denial。四门仍按现有 START_WORK_ROUTE 组合，不能把本地 read-only 退成全工作区 unavailable。

覆盖 prepare 的 repository read、preflight、createBranch、createWorktree，以及主 execution.startRun 和真实 fallback.startRun。仅当步骤会实际调用该 key 时才检查；已经 ack 的步骤不需要重做来证明权利。外部失败以结构码反馈实际 binding/key/target，只有 PermissionDenied 表示写许可撤销；ordinary offline 仍是临时不可用，不能转换成永久拒权。

拒权在下一次写之前生效，拒绝优先于旧 Saved replay。已在途写的真实 ack 不抹掉：先按当前主线的唯一 ledger/step record 落真事实，再拒绝后续步骤。若执行不确定，保留 Unknown/对账，不以新 key 或另一个执行者重试。权限变化不改规划 Status，不改 persisted policy。

显式重新验证与实际写确认分开。沿既有 getStartWorkOptions/Start Work 表单接安全 validation/retry，不新增 deferred operation 名或 access dashboard；现有参数可在无发布兼容约束下有界调整。首批需在 A 的实际接口上固定消费者接线：普通 options 校验只能更新声明/许可证据和 retry 资格，静态 describe、另一个 key 的读成功绝不能冒充先前失败写已 ack。

对运行时实际 write denial 的显式重试保留 actor/target/request intent，确定失败的权限响应必须撤销该表单先前的 validation 资格；保留错误与 partial ack 的展示，重新显式验证通过后才允许新尝试。Unknown/pending 保持原 key 的读回资格，不归入确定失败。确定失败后由既有 client 生成明确的新 attempt/key；同一 settled receipt 不从 failed 改回 pending，同 key 只重放，Unknown 仍用原键读回/对账。可做局部 probe admission，但不先把旧事实全局标为允许或 Saved。成功以该次写 ack/reconcile 为准；失败继续只禁该 key。capability 未实现和 policy 禁止不可被 retry 豁免。若现有 options/submit 无法表达一次 explicit retry，先记录最小参数契约并补判别测试，再实施；不引入后台自动写重试。

安全解释从 Host/Core 透传，点名 key、permission/capability/policy 层、仍可读的信息与 validation/retry 动作。透传安全固定原因，禁止 Provider 原始 message、SQL、secret 或本机路径。client 请求代次在 scope/access 变化后失效，旧 response 不能恢复按钮或覆盖新拒绝状态。

### 唯一生产 browser carrier

保留 fixture 的 SQLite、createHostComposition、installHostRemote 和现有 production client apply。HTTP unary 桥从 OPERATIONS 的 unary 声明推导，转调真实 installed.service，不能手工维护另一 operation 表或 controller proxy。未知 operation、stream 名冒充 unary、未知字段必须继续拒绝。

browser `$stream` 消费服务端真实 `host.watch` 帧：baseline/delta/metadata/gap 原样传递，客户端现有同步监督者负责 gap 重开。桥只赋输送 generation 和转发 accept/abort，不生成业务内容、capabilities 或同 revision baseline。restart、disconnect、dispose 均正常释放 host stream，不能留下挂起响应或多 scheduler。

控制端仅作用于 mounted Provider fault/permission、hold/release 真 Provider Promise、可重复的现有定时 tick；不得覆盖 controller.getEntity、baseline、wire metadata 或 client store。为执行状态保留原先非权限 fixture 功能时，明确那是既有测试 seam，不能用于本任务 authority proof。旧 visibility 操作迁移为真实 Planning Provider 行级 redaction或源拒读，不保留平行假权限路径。

用同一 browser carrier 实际打开列表与 drawer，维持页面不 reload，跑完整矩阵：Planning denial/late success/recovery、Planning offline stale、Delivery pipeline/check 局部 denial、Delivery offline permitted stale、单写 key denial、direct command 新 key/旧 replay、部分 ack 后拒绝下一步、恢复。保留键盘/focus、status/retry 可达证据，且至少一个被允许的其它操作可继续。

浏览器场景必须可重复执行：场景模块仅导出正式E2E实际消费的数据；按本计划自包含的控制步骤与DOM判据使用真实browser自动化工具执行；记录启动命令、head、测试选择、DOM canary、观察结果与截图。Node 静态 HTML 或手工点击叙述不能单独冒称真实 browser。

## Global Constraints

R11正式文档补充写集为 `docs/review/pr-472-mutations.md` 与既有 `docs/review/pr-472-mmp-review.md`、本计划和索引；保存作者旧13/新5及独立6的完整可重放定义，不新增产品或测试文件，不改变1162代码预算。

R472-U1 历史批次唯一写集（Superseded by Batch R5 / R7，2026-11-02）：`packages/ui/src/start-work-section.ts`、`tests/contract/ui-start-work.test.js`、本 active 计划、`docs/README.md` 与 `docs/review/pr-472-mmp-review.md`。不改 Core/Host、不重放父层、不 commit/push/merge。以下原文件集为本 PR 历史总范围，不是本修复新增授权。

文件集：`packages/core/src/runtime-access.ts`（仅已发货写观察/validation 接入）、`packages/core/src/git-provisioning.ts`、`packages/core/src/start-work.ts`（只接逐步门，协调 #204 共享片段）；必要 `packages/core/src/queries.ts`、`packages/core/src/context.ts`、`packages/core/src/status-policy.ts` 与 `packages/controller/src/commands.ts`；`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host-operations.ts`（仅既有 options/submit 参数接线）；`packages/client/src/start-work.ts`；`packages/ui-model/src/work-item-detail-view.ts`；`packages/ui/src/start-work-section.ts`、`packages/ui/src/work-item-detail.ts`；新 `tests/integration/runtime-operation-access.test.js`、`tests/integration/runtime-delivery-access.test.js`、`tests/integration/start-work-owner-fencing.test.js`、`tests/integration/start-work-request-binding.test.js`；既有 `tests/contract/harness-host-operations.test.js`、`tests/integration/harness-plugin-runtime-access.test.js`、`tests/integration/harness-plugin-execution-drawer.test.js` 的必要断言；唯一 `tests/fixtures/execution-drawer-browser.mjs`；新 `tests/e2e/runtime-access-browser.test.js` 与 `tests/fixtures/runtime-access-browser-scenarios.mjs`；`tests/contract/ui-start-work.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/integration/harness-plugin-start-work.test.js`、`tests/integration/start-work-sqlite-registration.test.js` 的必要断言；本计划及 `docs/README.md`。接口稳定后的具体差异先更新本节，禁止同 owner 区域并行写。

原严格预算为非 docs A+D ≤799、docs ≤1299（历史阶段，Superseded by Decision Log「2026-11-02 Ready 交付授权」）。历史完整872行候选当时按人类继续Ready指令收口；Superseded by Decision Log 的 R11 source a1 具体1162批准。原1000限制仅在该精确候选获例外，文档仍须1300以内。预测：逐步门/观察 90–140、client/UI/options 40–70、确定性写/partial ack 测试 170–210、carrier 替换（删除也计）160–210、真实 browser 场景 80–100、现有断言20–40，总计560–770；该预测尚未准入，也不把 C 当作已经保证 <800。

先复用 shared seed、OPERATIONS 推导和参数化场景，并删除被替代假 authority；不维护旧实验兼容。若真实 skeleton/TDD diff 表明完整 C ≥800，自动将“已发货逐步门/安全恢复”和“生产 carrier/browser 总验收”再分为两个完整 PR，各有独立计划与证据，最后一个才关闭 #457。用户没有 PR 数量上限，无需为这种保留验收的拆分重复请求批准。该预案已由具体837批准及2026-11-02完整候选Ready指令取代，不再拆分当前已验收的872行闭环。

没有 data migration、自动删除、上游权限写、政策/规划事实写、全局权限平台或新 UI 页面。真实凭据不进入测试。不得把本地测试当 hosted CI、真实 GitHub 撤权或人类 UAT。

## Plan of Work

### Batch 5 · R472-U1 同 scope 状态修复

已有用户条件授权由本会话处理只有 P2/P3 的后续；正式 review 5709139015 在 head `1795f5c` 只提出 R472-U1。实施者从本项 reviewer 转为唯一 UI owner，另一独立 agent 负责修复复评。只改 Global Constraints 指定的 UI 文件/测试与本计划、索引、评审记录；暂不重放父层，不提交、不 push、不 merge。

在检出 `fix/operation-runtime-browser` 的工作树根运行：

    node scripts/resolution-check.mjs && node --test tests/contract/ui-start-work.test.js
    pnpm test:file tests/contract/ui-start-work.test.js tests/contract/ui-work-item-detail.test.js tests/integration/harness-plugin-start-work.test.js tests/integration/runtime-operation-access.test.js tests/integration/start-work-sqlite-registration.test.js
    pnpm run typecheck
    git diff --numstat --find-renames f64e51446bd9fb07cdd899befd9d604f09a8a696

预期先因同 scope 状态被清空/旧权限结果污染而 RED，再全部 GREEN；保留完整前述安全断言。修复前代码 A+D=795，<800 仅余4行，完整状态分离与正规测试预计825–845；必须机械重算真实代价。预算若无法经同责任自然简化满足，交协调者裁决额外完整切片，不压缩算法、不删除安全测试、不谎称已过门。回滚本批 UI/test 差异；不清除 client intent、数据库或外部资源。

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

第一条执行可重复场景的 Node/桥契约，不能替代 browser。第二条期望打印 localhost 地址并保持服务；在可用真实 browser 工具打开该地址，运行本节明确的相同控制步骤与DOM判据。实施者须把实际 browser 工具入口、命令/参数及结果写入本节，缺浏览器执行证据则本批未完成。中止后 fixture 应关闭全部 stream/SQLite/HTTP。

隔离负控撤去 runtime owner 的拒读观察，使真实query继续投影旧事实；实际browser的相同title/body canary必须失败，再逐字恢复并重跑。这个负控比只改HTML更贴近授权根因；实际执行见本节最终证据。不能用只隐藏按钮的负控替代。回滚 fixture/test coherence，已存在 A/B 安全实现保留。

2026-10-30 第一阶段本地证据：在 `fix/operation-runtime-browser` 的 `2f04105` 上，仅修改 fixture、新增浏览器桥契约和导出场景，未进入 Core/UI 的并发区域。`pnpm test:file tests/e2e/runtime-access-browser.test.js` 先因真实 `/remote` 与 `/watch` 未实现而失败；替换后新三项桥契约、既有三项 drawer 正控与两项 runtime access 集成共 8/8 通过。新增 `getWorkspaceSetup` 的 `confirmed` 断言进一步复现旧 seed 缺真实 `projectNodeId` 导致页面困在 setup，已通过 SQLite `putBindingConfiguration` 和受信 fixture schema 补齐，未覆盖 Host setup 返回。运行命令使用仓库固定的 pnpm 10.28.2。

浏览器复现入口仍是 `node tests/fixtures/execution-drawer-browser.mjs`；页面挂载后 `window.fixture.command(action,value)` 仅控制 mounted Provider `fault`（`domain/kind/enabled`）、真实 Provider Promise 的 `hold`（`domain/method/enabled`）和 `release`。`inspect` 返回请求记录与活动 stream/held 计数；`status` 是既有非权限执行正控 seam。`window.fixture.remote` 是从 `OPERATIONS` 推导的全部 unary，HTTP `/remote` 以 `{name,input}` 转调真实 installed service，`/watch` 透传真实 installed watch。`tests/fixtures/runtime-access-browser-scenarios.mjs` 最初还导出同页步骤和断言，但这些导出从未接入正式测试或实际浏览器执行，Superseded by 本节 R5 自包含执行判据（2026-11-02）；当前模块只保留Node E2E消费的数据，浏览器由协调者按本节步骤执行；当时真实浏览器矩阵仍待验证；Superseded by 本节最终证据（2026-10-30），不以Node通过替代。

2026-10-30 最终真实browser证据（源head `852b089`，协调者以CUA驱动真实浏览器）：Planning离线正文保留且stale，其它Delivery读仍可用；实际拒权隐藏title/body/source；挂起旧listPlanningItems成功、经既有bootstrapWorkspace收到较新拒绝后释放旧响应，title/body仍不可见。恢复两轮后ExecutionContextSection DOM数量均为1，拒权时0，不累积旧节点。

Delivery正控通过mounted Development的真实createBranch/createChangeRequest和installed.service.refreshDeliveryFacts建立，未直接灌入projection。离线保留pipeline/check并显示陈旧；拒pipeline时只留check，拒check时pipeline已恢复；Planning仍成功刷新。worktree.create拒绝时表单禁用并说明key/layer；显式重验后hold branch ack再撤worktree权限，外部计数由2/0/2到3/0/2（branch/worktree/run），保留分支且无假Saved；旧资格失效。恢复后再次显式validation并用新key，计数为3/1/3；真实执行reader读到工作树与运行中。重放旧失败key仍保留原失败/branch且无新增外部写。

真实SQLite redaction失败由下列临时测试fault触发，Host原样发出baseline r1→gap r1→baseline r1；生产client自动重开而不编造revision。故障恢复后同页可见正文。浏览器reload后列表5行，close后inspect为held=0/streams=0。UI操作用CUA locator/键盘；只读DOM读取canary、状态区、disabled、focus和section数量，未用evaluate修改应用状态。

完整复现：在检出 `fix/operation-runtime-browser` 的工作树根运行以下临时验证入口，打印URL后用真实browser打开。HTTP `/control` 输入及浏览器步骤见Design和场景模块。标准不带交付seed的入口仍为前述fixture命令。

    node --input-type=module <<'JS'
    import { startExecutionServer } from './tests/fixtures/execution-drawer-browser.mjs'
    import { SqliteStorage } from '@harness-projects/storage-sqlite'
    const h = await startExecutionServer(), dev = h.byDomain.development
    const repository = dev.state.repositories[0].ref
    const branch = await dev.createBranch({ repository, name: `work/${h.itemId}`, fromRef: 'main' })
    if (!branch.ok) throw new Error('fixture branch seed failed')
    const pr = await dev.createChangeRequest({ repository, head: branch.value.name, base: 'main', title: 'browser-delivery-canary', body: '' })
    if (!pr.ok) throw new Error('fixture PR seed failed')
    await h.installed.service.refreshDeliveryFacts({ kind: 'user' }, h.itemId, 'repo-alpha')
    const frames = [], watch = h.installed.service.watch
    h.installed.service.watch = async function* (signal) { for await (const frame of watch(signal)) { frames.push(frame); yield frame } }
    const replace = SqliteStorage.prototype.replacePlanningProjections
    let failRedaction = false
    SqliteStorage.prototype.replacePlanningProjections = function(scope, rows) {
      if (failRedaction && rows.some(row => row.content.contentKind === 'redacted')) throw new Error('fixture-redaction-disk-fault')
      return replace.call(this, scope, rows)
    }
    console.log(h.url)
    process.on('SIGUSR2', () => { failRedaction = !failRedaction; console.log({ failRedaction, frames: frames.map(frame => ({ kind: frame.kind, revision: frame.baseline?.revision ?? frame.gap?.currentRevision })) }) })
    process.on('SIGINT', async () => { await h.close(); process.exit(0) })
    JS

SIGUSR2开关本次临时SQLite的真实写故障并打印未修改的Host帧；本次运行用等价stdin控制，未更改产品Storage、Host/controller reader或生产apply。这个测试seam与Provider权限控制彼此独立，不能拿它冒充授权。

隔离browser负控从固定源码归档，在副本唯一移除 `runtime-access.ts::deny` 的 `denied = true`，保持实际Provider PermissionDenied及生产carrier；相同刷新后title/body可见，拒权canary失败。逐字恢复该行、重启副本后相同canary再次隐藏title/body并有denial解释；产品工作树未删门。首次启动归档缺apps依赖导致esbuild加载失败，复制相对workspace依赖并经resolution-check后重跑，未把装配失败算作有效RED。

### Batch 4 · 全问题收口

主文件为本计划与 docs 索引。在实际 stack base 上运行 narrow suite 后运行完整 verify；整理提交、五类发布面扫描、严格规模及最终远端 head/base/checks/issue/threads 回读。A/B 合并后才把 origin/main 当基线，未合并时写实际 parent branch 的可复制命令。

    pnpm verify
    node scripts/workflow-check.mjs
    git diff --numstat origin/main...HEAD
    git diff --check origin/main...HEAD

再对实际 base 运行 `node scripts/rule-checks.mjs disclosure <实际base>` 与 `size <实际base>`，独立累计 code/test/config/fixture A+D≤799/docs≤1299。原 #457 五条验收逐条映射 A/B/C 真实证据后，关联 PR 才可提出关闭；最终 push 后远端回读全绿才 ready，人类决定 merge。回滚 C 保留 A/B，组合回滚按依赖逆序。

### Batch R5 · 跨操作/交付表面的共享读健康

R472-C1/P1 与 C2/P2 来自同一读拒绝双 authority：实际 Development read 的 PermissionDenied 只写 operations Map，另一既存/新 owner 不观察；同key完整 Delivery refresh ack 后又因旧 Map reason 遮罩不能只读恢复。operations 仅保留实际写拒绝；实际读必须复用既有 DeliveryHealth/SyncCursor 和 committed fence，不能新增权限数据库或单独恢复写者。

独立比较两种最小方案：在 read wrapper 调用现有 begin/deny/settle/recover 协议，或向 operations 增共享持久写者。选择前者；Provider前 marker ack、真实拒读共享结算，单方法成功只结束pending，完整同 binding/key/target/scope 的读及facts事务ack才恢复。describe、其它key成功和额外StartWork创建资源均不能替代只读恢复，也不能清实际write denial。

在检出 `fix/operation-runtime-browser` 的工作树根运行 `pnpm test:file tests/integration/runtime-operation-access.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/delivery-read-fence.test.js` 和 `pnpm typecheck`。期望Memory/SQLite及真实多Host原跨owner泄漏/恢复反例先RED后GREEN，保留读写/目标隔离、marker失败零Provider、失败事务保守遮罩、旧成功不覆盖新denial、恢复ack前不可见。root统一跑完整verify；全部判别与固定source独立复评通过后冻结。回滚为完整本批协议接合，不回退#469 fence、不删库或外部资源。

### Batch R7 · 标记、拒读与完整确认的不同版本职责

整合 main 的执行回执/唯一性与 PR 操作后，完整回归暴露普通并发读取被 marker version 互相撤销，以及安全读取 marker 使旧整库快照断言过宽。独立反例又确认：新 begin 不能吞掉在途实际拒读；拒读结算失败留下的 pending 不能被后续单方法成功擦除；旧 owned 不能抵消完整确认后的新读取。

继续使用同一个 DeliveryHealth 游标。version 隔离旧事实提交；denialVersion 记录实际拒读的版本，只有它或 operationVersion 变化才淘汰旧操作读取；confirmedVersion 记录完整 facts+scope 事务确认。pending 的 cohort 是这两个确认版本的较大值，表示同一确认边界内尚未结清的读取；普通 begin 只增加 marker 与 pending，不丢旧计数。普通完成只扣自己的 cohort，实际拒读或完整事实确认才替换 cohort。旧拒读仅在已有更新完整确认时失效，不能被单纯开始另一读取取代。失败的拒读结算保留未确认 marker，额外 Start Work 即使成功也不恢复缓存。

两个整库测试仅放行同 workspace/binding/RepoRead/target 的明确中性读健康变化：owner-loss 只允许 version+1；竞争认领 loser 只允许自己的 pending 1→0。其它健康字段、全部业务表、receipt、身份与句柄仍逐字比较，默认快照没有放宽。首次写后的合法已发操作保留 runtime gate，不重新否定已移除目标；新 main 的 active owner、持久回执和执行唯一性完整保留。

在检出 `fix/operation-runtime-browser` 的工作树根运行 `pnpm verify`、原 Batch R5 窄命令及 `pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-request-binding.test.js tests/e2e/start-work.test.js tests/integration/harness-plugin-host-authority.test.js`。隔离 archive 副本用 `node scripts/review-mutate.mjs <spec> --root <snapshot>` 做基线 GREEN、具名 RED、逐字还原 GREEN；禁止暂退 owner 工作树安全代码。规模用当前直接父层 `git diff --numstat fix/delivery-runtime-access...HEAD` 重算；超过 1000 时只冻结可审阅结果，未经具体预算裁定不得发布或 Ready。当前无新增产品范围或延期安全债务。

### Batch R11 · 未 ack 拒读的因果证据与持久证明

R10 独立复评把原 C1/C2 标为 PARTIALLY_ADDRESSED：Memory 中迟到 begin ack 以同 marker 版本洗掉已经实际观察的拒读；两adapter双拒读结算失败时，本地虚增版本又盖住 peer 完整确认，并在下一 begin 将旧 health 写回造成 proof/scopes 回退。旧绿色15探针/13负控仅属于原窗口。

独立两方案比较与协议审订后选择持久镜像和本地未 ack 拒读元数据分开：Delivery Map 只安装已提交 health，Storage version 只由事务推进；本地实际拒读记录票据 cause 和单调 observation，立即拒绝发布。install同时保持持久 version/denialVersion/confirmedVersion 单调；仅完整 facts+scope ack 的 confirmedVersion 严格晚于 cause 才清本地 mask，不回退 observation。begin只从tx.load开始，不再将本地 observed health 整包写回。operation与fullread票据在begin await前捕 observation，最终同时核对；repo accessVersion包含该单调观察号，完整恢复不能复活旧票据。原 pending/cohort、scope、读写key、binding/target以及事务 ack 边界保留，无schema或第二权限authority。

正式既有 fixture 增补Memory真实guarded Provider迟到ack、双Storage双结算失败及peerproof后成功新操作不回退、旧operation ABA、同持久版本旧fullread与访问token。新7项在旧source为2pass/5fail，2项ABA旧算法已有通过，不冒称全部为新RED；当前396定向、完整3380+7/typecheck及6原R10反例通过。source `a1a3a88`（2026-11-02 SGT，直接父层 `4cf723b`）只改两个产品/正式测试文件；实际代码1162，人类已批准该具体候选。完整独立复评APPROVE、原C1/C2 ADDRESSED且无新增finding，最终head远端门仍待完成。所有mutation在隔离快照，禁止退owner安全代码。

### R5 自包含浏览器执行判据

在 `fix/operation-runtime-browser` 工作树根运行 `node tests/fixtures/execution-drawer-browser.mjs`，用真实浏览器打开打印地址，不带 scenario 查询。页面使用默认 strict unary/watch 与 installed Host。执行 `await window.fixture.command('fault', { domain: 'planning', kind: 'permission_denied', enabled: true })` 后点击实际“刷新规划”：DOM不得有“规划项 issue-1”或“issue-1 正文占位”，必须有 planning.item.read 的拒读解释和可用刷新按钮；保留已开详情，不能靠reload或另一页面完成恢复。将enabled改false并再次点击后，同一详情的标题/正文恢复；对旧在途读取用hold/release安排，拒读后释放旧成功也不得外发这两个canary。

操作判据使用实际“规划项 issue-2”：`window.fixture.command('permission', { domain: 'development', key: 'development.worktree.create', enabled: false })` 应使对应提交disabled并解释key。若在createBranch已ack后拒绝后续worktree，页面保留work/分支句柄、不显示“开始工作已确认”，worktree/run外部计数不增加，已ack资源不删除；恢复权限并显式“重新验证权限”后，确定失败的新attempt可复用已确认branch。Unknown/Pending始终沿原key读回，metadata拒权更新不清未决结果，不起第二个执行者。用`window.fixture.command('inspect')`回读实际请求键和branch/worktree/run计数；卸载后streams=0、held=0。

上述是实际浏览器与Provider控制判据，不是未调用JS断言导出。四个未接入的导出及其两个无消费者字段已删除，所有正式Node/Host/UI/E2E和真实浏览器判断保留。新的R5共享拒读还必须以正式多Host/source事务测试验证，不能用这个单页面矩阵替代跨owner安全性。

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

- [x] 2026-11-02 SGT：R11同source独立协议85正式/3健康并发Gateway/6原R10/2token票据ABA诊断通过，无新finding；旧13映射与新增5具名隔离负控全KILLED、基线和逐字还原GREEN。具体1162人类预算已批准，协调者当前source复评仍待完成。

- [x] 2026-11-02 SGT：R11 source a1a3a88 已正式集成，原Memory迟到ack/双adapter连续失败结算的5项真实RED修复；396定向、6原R10反例和完整3380+7/typecheck通过，现1162代码/新增88预算与协调者复评待完成。

- [x] 2026-11-02 SGT：历史R5共享读健康/恢复修复、旧请求/owned代际及descriptor正反回归完成，82正式+6外部探针/typecheck通过；实际代码1000行保留全部判别，产品冻结（Superseded by Batch R7）。
- [x] 2026-11-02 SGT：R7正式完整3277+7、原15probe、13具名隔离负控及独立局部复评通过。
- [x] 2026-11-02 SGT：source06c90c9具体1074行预算已获人类批准，仅归该候选。
- [x] 2026-11-02 SGT：人类具体1162预算和完整独立MMP技术复评均通过，C1/C2 ADDRESSED、无新P0–P3；技术闭环完成归档。最终文档head CI/正式当前head批准与作者线程回读后Ready。
- [ ] 2026-11-02 SGT：在最终父层串行重放，完整verify、有效隔离负控与root独立新head复评；新验收前不resolve/Ready。

- [x] 2026-10-30 Batch 5：正规 RED 13 pass/3 fail → GREEN 16/16；关联185/185、typecheck exit 0；已测精确预算837，严格<800门未过。
- [x] 2026-11-02 Batch 5：R472-U1独立复评及具体候选Ready交付授权已完成，当前父层上独立99/99、完整2877/2877加MVP-0 7/7通过，文档归档。

- [x] 2026-10-30（Asia/Singapore）：独立检查步骤门、发货 operation 表和现有 browser 夹具，建立候选计划。
- [x] 2026-10-30：确认 #204/A/B 当前接口，计划及串行 ownership 已冻结；当前本地父层为 `f43efcd`，当时hosted/独立复评仍待回读；Superseded by Outcomes & Retrospective（2026-10-30）。
- [x] 2026-10-30：Batch 1 红测试与最小消费者接线，当前26项操作判别用例通过。
- [x] 2026-10-30：Batch 2 逐步门、部分ack、局部恢复与隔离负控完成；独立修复复评仍待下一门。
- [x] 2026-10-30：Batch 3 唯一生产carrier、固定源码真实browser全矩阵、独立负控与恢复通过。
  - 2026-10-30：第一阶段 carrier 替换及 Node 8/8 通过，真实 setup seed 缺口已按有效 RED→GREEN 修复；等待实际 A/B 父层接口与协调者浏览器证据。
- [x] 2026-10-30：Batch 4 产品/独立验收、发布面、严格规模和源head远端门通过，完成归档；最终文档push后的Ready门按本节命令回读，未经回读不得执行Ready。

2026-10-30 第二阶段：父层 `a6477f2`、第一阶段 `c11dbdd` 的组合上，13 项 `runtime-operation-access.test.js` 通过。首批四项 RED 明确多创建了禁止的 branch/worktree/primary/fallback；后续 RED 覆盖 partial ack 返回、intent 提交窗口、Saved replay、runtime redaction 持久失败后的可信 Core status 调用、preflight 当前权限以及拒权结算本地失败。原 intent/owner/SQLite 与 UI/Host/browser 桥 narrow 257/257 通过；中间完整 `pnpm verify` 为主套件2691/2691、MVP0 7/7，补齐最后窗口后当前源码再次完整验证为2694/2694及MVP0 7/7。B 修复后实际父 head 尚需协调者串行重放并再次组合验证，当前本地绿不替代 hosted CI 或人类 UAT。

隔离负控位于 `.superpowers/operation-negative-probe`：`git archive` 导出并叠当前差异，复制依赖后先确认 `@harness-projects/core` 实际解析到副本，再只在副本移除各真实 write 前的当前权限采样。相同 operation 测试出现 7 项失败；另一次恢复副本步骤门、单独取消旧 ack 的版本条件，旧 ack 错误清掉新拒绝的用例失败。所属产品工作树从未临时删门或回滚。

协调者在中间服务同页完成 issue-2 单 key denial→解释与禁用→恢复后显式 validation→可提交，以及 hold branch ack→撤 worktree key→release 的 partial ack；外部计数保持 branches=2/worktrees=0/runs=2，界面保留 branch、没有工作树路径或新 run、没有假确认。该正控基于当时的 `a6477f2` 父层及 C 中间源码，最终 B 修复重放后仍需相同矩阵与跨域 browser 负控。

2026-10-30 新父层整合：重放到 B `f43efcd` 时唯一冲突为 `runtime-access.ts`，保留 B 完整持久协议并叠 C 操作门；自动合并区逐项核对了 Host final fence、构造器 Storage/workspace、metadata sync/双 epoch 和 UI ABA token。新增两项实际反例：Start Work 逐 key metadata 不得取消 `CHANGE_REQUEST_READ_ROUTE` 的 repository-read 前置门；C 操作拒绝必须推进既有 metadata epoch 与恢复后的 accessVersion。两项先红再绿，C operation 15/15，B/C/Host/browser 桥组合53/53，完整 `pnpm verify` 主套件2708/2708及MVP0 7/7。新隔离副本 `.superpowers/operation-final-parent-negative` 分别删步骤门、旧 ack 版本条件和 operation metadata epoch，得到7项、1项、1项失败，产品工作树保持原样。此结果只覆盖本地当前源码，最终同 head 浏览器由协调者集中执行。

2026-10-30 最终四反例修复（在 `fix/operation-runtime-browser`、父层 `f64e514`、`726b7e0` 加当前修复差异上）：独立复评原有两项 P1 和两项 P2 均先用 Memory/SQLite 正式测试复现失败。修复将 operation 版本捕获移到 descriptor await 前、逐个真实 Development read 贴门并区分失败 key、将 preflight PermissionDenied 观察到 worktree.create，以及先读 unresolved receipt 保留 Unknown 与已 ack 句柄。`pnpm test:file tests/integration/runtime-operation-access.test.js` 期望26/26；原独立8项探针在两种 Storage 各8/8；关联回归290/290；`pnpm verify` 主套件2719/2719及MVP0 7/7。四个独立隔离负控逐项撤销修复，均重新出现对应真实失败；产品树从未临时删门。上述是本地修复证据，尚未替代固定新head的独立复评、浏览器与远端门。

2026-10-30 固定 `fe5b163` 的独立限定复评已将 C-F1–F4 全部判 ADDRESSED；两份原8项探针在 Memory/SQLite 各8/8、正式操作26/26，指定修复diff未发现新回归。`test/core-delivery-integration` 在该SHA上叠独立 #436 能力后，`pnpm verify` 主套件2738/2738及MVP0 7/7。浏览器验收随后发现确定失败未撤销旧validation资格，故继续修复并保留最后同head验收门；上述数字不冒充后续UI修复后的验证。

2026-10-30 浏览器发现的资格失效修复由新独立实施者接手：当前代次收到确定失败的安全denial后撤旧options/validated，保留结果、partial ack与Unknown/Pending原键读回。有效RED为13 pass/1 fail（按钮disabled断言）；GREEN为UI15/15、关联Core/Host/SQLite158/158、`pnpm typecheck`通过、`pnpm test`2721/2721。修复仅1行生产和36行测试，当前相对B代码A+D772，未删验收或压缩算法。

2026-10-30 最终UI资格修复 `041739a`：独立复评UI15/15与关联158/158通过；完整五PR组合 `pnpm verify` 为2740/2740及MVP0 7/7。相同生产client浏览器观测真实SQLite redaction写失败：Host实际frame为baseline r1→gap r1→baseline r1，页面隐藏标题正文且同Host可恢复；direct Start Work被拒且外部计数不变。浏览器也确认partial拒绝后旧资格失效，恢复后新尝试复用branch并将worktree/run各增加1。其后DOM两次恢复暴露ExecutionContextSection与StartWorkSection兄弟key相同，导致保留重复执行区；最小namespace修复先RED（唯一key1≠2）再GREEN（drawer+Start Work26/26、typecheck）。当前总代码A+D795，最终DOM重复循环另行复验。

## Surprises & Discoveries

2026-10-30 R472-U1 正规扩展测试重放 same-scope available→denied：原树三项有效 RED（partial ack 的降级结果消失、Unknown/Pending 文案由读回改成提交、pending metadata 被当作完成解除）。根因是同一个 generation/effect 同时承载 target identity 与 access/options。最小修复为独立 commandGeneration：target/lifecycle 变化清命令；access 变化仍用原 generation 使 options/validation 失效，只保留当前命令的真实 completion。先前安全资格断言、原键重放、目标变化旧响应隔离均保留。

实际代价：在 `1795f5c` 上本修复产品10A/4D，测试33A/1D，共48；相对直接父层 `f64e514` 的整PR代码/测试/config为837（原795净增42）。采用复用既有partial/Unknown/Pending用例，未删除安全测试或压缩算法；<800门明确失败，仍低于仓库1000硬门。不能在预算裁决前宣称Ready/push条件满足。

既有 frozen route 同时携初始 capability 快照，故其身份稳定性不证明当前授权；Execution resolve 后仍有 await，门必须贴实际副作用。已有 client `StartWorkResult` 丢弃 error，泛化“失败可重试”不能完成 key/layer 解释。

既有 browser `$stream` 将手工 baseline 包装为新 generation，controller visibility 也被覆盖；这只证明展示守卫，不证明生产权限。替换会同时计删除与新增，C 的规模风险主要在此，必须保留实际 diff 准入门。

实际浏览器首先暴露旧 fixture 虽有投影但没有持久 `BindingConfiguration.projectNodeId`，导致 Host 真实 setup 状态为 `degraded`，页面无法进入列表。直接 unary/watch 契约此前未覆盖 setup 准入，新增真实 setup 断言后修复 seed；不能从 baseline 含业务行推断生产页面可达。

独立反例还证明：descriptor 成功仅是读取时的声明，不能覆盖 await 期间更新的实际拒绝；前置准入也不能覆盖之后的真实读。故逐真实读 guard 仅包装 getRepository/listBranches/getWorktree/preflightWorktree 四个既有方法，不新增权限账本。Unknown 不是确定失败，必须先保留原 receipt 再表达当前不可继续条件。

## Decision Log

- 2026-11-02 SGT · 全部开放PR接管：本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。本授权明确覆盖当前PR #472，由本评审会话接管修复/独立复评、实际base重放、当前head门禁、issue核对及rebase merge。旧阶段“不merge/仅Ready”的限制仅在合并授权上 Superseded by 本决策；技术、范围、预算、凭据与人类UAT/R1门保持。Planning Status及native依赖关系仍不写入。

- Decision：人类批准source `a1a3a88` 的具体1162行候选，较既有1074行具体例外增加88。
  Rationale：本聊天原话“批准这两个具体候选，继续 Ready”；保留全部修复和判别测试。仅该source及精确规模例外，当前head独立评审、CI与远端回读仍需通过，不合并、不改变其它预算或范围。
  Date/Author：2026-11-02 SGT / 本聊天人类裁定，owner记录。

- Decision：人类批准仅 #472 冻结 source `06c90c930e4163e3a78e92744423411f45d71547` 的 1074 行具体预算例外。
  Rationale：本聊天原话“批准该具体 1074 行候选，继续 Ready”；保留完整修复及判别。该批准仅放行该候选的74行规模例外，不替代独立当前head复评、CI/远端回读，不扩大其它PR预算，也不授权merge。父层共享Planning F1仍未通过，故当前整栈仍不可Ready。
  Date/Author：2026-11-02 SGT / 本聊天人类裁定，owner记录。

- Decision：2026-11-02 Ready 交付授权，继续完整872行候选。
  Rationale：在已明确说明 #466 854行与 #472 872行、旧具体批准数字和四个Draft原因后，人类原话“继续并完成 ready 交付”。按这个具体上下文继续现有闭环的必要整合、归档、CI与Ready，不重复拆分或删测试；本轮不执行merge，也不推导UAT/R1或规划Status接受。
  Date/Author：2026-11-02 SGT / 人类指令，当前交付owner记录。

- 2026-10-30：本会话人类对具体修复和测试作出预算裁决：“允许本 PR 837 行，保留完整修复和测试（建议）”。R472-U1 修复的实际整 PR 代码/测试/config A+D 为837，局部超出原800预算获本次特定授权，仍低于仓库1000硬限；不扩大其它PR预算，也不授权删安全验收或跳过前层P1复评。


- 2026-10-30：人类已条件授权只有 P2/P3 时由本会话修复。根协调者指定本项原 reviewer 为唯一 UI 实施 owner；批准的设计是 target identity 清空、同 scope access 只撤资格并保留完整命令状态，旧 options/completion 不恢复新拒绝。修复独立复评、父层 P1 与预算门未完成前，不声称 #457 已全验收。

- Decision：把 C 定义为已发货操作准入与生产浏览器接受闭环，明确 stack #204→A→B，与 #204 共享片段串行整合；此前“只 stack A/B”判断已由真实准入反例取代。
  Rationale：不拆连续权限算法，又将原 B 超预算半径收敛到独立可验证交付。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。
- Decision：write denial 恢复须区分 retry资格与外部ack，保留 request intent 并对确定失败使用明确的新 attempt/key，不靠静态 describe 清掉真实确认责任；同 key settled receipt 和 Unknown 不绕过 #204。
  Rationale：客户端不能先显示Saved，安全读的成功不能证明写操作发生。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。
- Decision：复用原 Host `getStartWorkOptions` 接内部 `validateStartWork`；不把 Provider I/O 塞进纯 query，不新增 remote operation。初始自动 options 不解除已知 write denial，只有用户显式 validation 可给当前表单 retry 资格，实际 key 仍在 write ack/reconcile 后恢复。
  Rationale：独立的安全验证与已有确定失败后的新 attempt 能保持 immutable receipt、Unknown 和权限证据边界。
  Date/Author：2026-10-30（Asia/Singapore）/ 实施者与协调者。

## Idempotence and Recovery

重复校验只更新对应目标证据，不触发写；重复显式写意图沿当前主线原幂等/对账。已 ack 资源保留，Unknown 不自动起第二个执行者；旧 epoch response 不能改变新 access 或 UI。

fixture 仅创建任务临时 SQLite/root，close 重复安全；发生失败先 abort stream、release held Provider 再关闭，不清理用户库。负控在隔离副本运行并恢复。回滚不修改 upstream permission、凭据或 persisted policy；回退本切片会重新暴露逐步权限窗口，须记录该风险。

## Interfaces and Dependencies

Node ≥22、pnpm、现有 fake/SQLite、esbuild、真实本机 browser 工具，无真实平台凭据。A/B 提供权限拥有者和目标 metadata；admission/ledger/ack 恢复明确依赖已叠入的 #204 唯一 `BeforeExternalWrite` 和 durable intent。初始“不依赖 #204 新 hook”判断已被实际源码反例取代。Core 的 `validateStartWork` 只由既有 Host `getStartWorkOptions` 调用：安全重采样当前 Provider 声明并报告 retry 资格，不新增 remote operation、不清实际写拒绝、不确认 Saved。

OPERATIONS 是唯一声明，HTTP bridge 从它推导 unary；stream 直接转发 Host watch。#450/#451 和 UI detail/forms 不作为前提。未知真实浏览器工具不可伪造成功；只允许在工具确实不可用时记阻塞，Node绿不能关闭总验收。

当前不接受技术债延期；若为规模拆 C，应建立下一份独立计划，保留 #457 open。确实接受的后续维护债按 `docs/exec-plan/tech-debt-tracker.md` 登记，不得把必要权限/browser证据记为“已接受延期”。

## Outcomes & Retrospective

R11完整独立MMP复评（2026-11-02 SGT，source a1a3a88）：原actualC1旧0/1→新1/1，双拒读失败恢复及下一begin旧0/4→新4/4，126正式、3健康并发、2partialscope、6祖先/结清fence、39UI/strictcarrier、原R5多Host6、boundaries9/typecheck通过，六具名因果负控KILLED、805文件逐字还原。结论APPROVE（本层技术）、R472-C1/C2 ADDRESSED，新增P0–P3为零；未重跑独立全量或新DOM，owner3380+7仍按其执行归属。具体1162预算已批准，无延期技术债。最终产品等价head仍需CI/正式批准与线程/关联回读，再作者Ready；非UAT/R1/issue接受或merge。

R11当前source `a1a3a88`（2026-11-02 SGT，直接父 `4cf723b`）：持久health与未ack实际拒读因果overlay分开，旧ack不清拒读、新begin不退proof、完整恢复不复活旧operation/fullread。新7项旧source2pass/5fail→GREEN，396定向、6原R10反例及完整3380+7/typecheck通过；1162代码较原1074具体批准新增88，人类已批准该具体候选，完整独立复评APPROVE；远端门仍待完成。下列R7/R5原版本绿与预算不替代此门。

R5实现候选source `aac450431a2baf31fdf5332d1e853cb88ad86862`、原base `57a9f77d039ba9a63ef02af35ae17d903cd8caf6`（2026-11-02 SGT）：实际getRepository/listBranches拒读进入既有共享DeliveryHealth，operation读begin换代并按started代抵消owned，旧事实事务不能把新未完成marker当恢复；单方法/descriptor成功不清实际读拒绝，只有当前scope完整facts事务ack恢复。实际write拒绝不被describe/其它key恢复；未由Delivery读取的WorktreeRead保留既有operation同key语义，不创建无确认路径的通用持久权限系统。

历史该候选82项正式窄回归、原4个外部探针6项、typecheck与diff通过（Superseded by Batch R7，2026-11-02）；完整验证和最终父层上独立复评由root在串行重放后执行。完整candidate曾为1041行，独立核对后删除34行未接入浏览器脚手架/字段、自然参数化复用7行重复测试准备，全部实际断言保留且分支拒绝场景扩大到SQLite，当前代码A+D1000恰达硬限。未借格式压行、删除case或保留可达P1的base先交付。

2026-11-02 R5 复审重开本计划；下列已完成结论仅对应当时固定 source，不代表本批新反例已闭合。当前 R5 设计及实际进度见本节新增批次和 Progress，最终完整验证与独立复评通过后才重新归档。

2026-11-02 当前source `4c777b66f0c27f4de4547af8a32f42d30f31869c`、base `57a9f77d039ba9a63ef02af35ae17d903cd8caf6`。本层12个生产文件与旧ab20c15逐字一致，继承main的默认viewport样式一行；主线shell/settings/status和默认strict生产bridge均保留。独立99/99、Gate三帧身份保全探针、完整`pnpm verify`2877/2877加MVP-0 7/7和typecheck通过。当前无新增P0–P3，R472-U1保持ADDRESSED，代码872；未把旧837批准伪写为逐字872批准，继续Ready上下文授权见Decision Log。

当前source用独立Chrome会话打开默认生产carrier，实际Panel/workspace Gate经过真实Host/watch/client.apply：打开issue-1详情，mounted Planning Provider拒读，点击实际刷新按钮后title/body均隐藏、dialog仍开且按钮enabled；恢复Provider后再点刷新，同一已开详情恢复title/body，只有一个dialog。Escape关闭，来源anchor因拒读时断开而按既有规则落到安全列表H2；卸载后DOM空、streams=0、held=0。只有Provider fault作为权限输入，没有scenario-only DTO、Controller override或合成baseline。这是本地fake Provider浏览器证据，不是安装件人类UAT或R1。

以下2026-10-30轮次与数字按各自source保留为历史证据；当时未决状态由本节当前结果和Decision Log取代，不作为当前Ready或CI状态。

2026-10-30 R472-U1 当前修复实现与窄验证完成：在检出 `fix/operation-runtime-browser` 的工作树根、`1795f5c` 加本批差异上，正规 UI RED 13/16 → GREEN16/16；Batch5关联命令185/185，`pnpm run typecheck` exit0。仅分离UI命令/访问生命周期，无Core/Host/持久数据变化。`pnpm test`完整主套件2723/2723、0 fail/skip；三个正式`review-mutate`变异（清result、清pending、放行旧options）各由指定用例KILLED，基线/逐字还原后基线GREEN，exit0。独立复评、预算裁决、父层P1修复/rebase及最终交付门保持未完成。

以下历史完成结论 Superseded by Batch 5 与本次评审记录（2026-10-30）：当时 R472-U1/P2 已重开，#469 继承 P1 由其 owner 修复；当时不是已完成交付状态。Superseded by 本节2026-11-02当前结果。

最终产品源码锁定 `852b089c40b99c39c24efc2b82fc2a37ab18d207`，直接父层 `f64e51446bd9fb07cdd899befd9d604f09a8a696`。四个Core反例、UI资格和兄弟key两项均由独立实施/限定复评闭环；无开放的本切片阻断finding。两套Storage探针及26操作用例、最终UI26用例通过；最后namespace前的完整五PR组合为2740+7，namespace后的同源码hosted Verify/Integration/E2E/Boundaries/MVP-0/CodeQL/PR Fast Gate均成功。 最终namespace源码再与独立#436组合，在检出`test/core-delivery-integration`（`1ce66a1cd64f511fb831d5e106aafc69b2b54607`）的工作树根执行`pnpm verify`，主套件2741/2741及MVP0 7/7通过。命令 `gh pr view 472 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup` 可重算，不能把源head结果套到最终文档head；最终文档归档commit必须证明packages/apps/tests与源head逐字相同，再重新回读远端。

实际browser在该固定源码上完成Planning offline/denial/recovery/late成功、Delivery offline/逐key denial/recovery、写拒绝/显式validation/partial ack/新key恢复/旧key重放，以及gap重开、键盘进入/Escape/Tab、role=status和卸载。无真实凭据的fake Providers与临时SQLite是证据边界，不是已安装Harness、人类UAT、真实GitHub撤权或R1。本PR只提出关闭#457；完整#144、#193、#421、#458与R1保持独立。技术债tracker已复查，本切片未以预算为由接受新延期。

### Artifacts and Notes

原始日志、截图和负控只保存在任务运行态目录；本计划维护真实命令、分支、head 和结果。

### 当前父层整合补记（2026-10-30）
协调者已把完整四层实现重放到 Planning `07f150fff9e125eee856c0db4d20c00425938957` 与 Delivery `db6b01df3bfa083a82722a119876c66eefd0f516` 的冻结候选。原 #472 本地 head `758f812` 由 `backup/pr472-before-frozen-parent-rebase-20261030` 保存；只有本切片 own 文件被修改，父层 `planningReadState` 与 `committedFence`、当前UI样式/焦点、计划索引全部保留。

首次组合窄验证69/70，唯一失败为已交付视觉showcase契约被新生产bridge移除。修复保留显式 `scenario` 展示输入，并使默认unary/watch继续直接调用真实installed Host；没有默认Controller-return覆盖、合成baseline或权限authority。默认legacy输入仍拒绝，视觉context必须带显式场景。权限metadata变化不夺走用户已移出的焦点，命令结果代次与访问资格分别失效。

当前父层完整 `pnpm verify`：2837/2837及MVP0 7/7，typecheck通过；这与此前父层上2723项是不同版本证据。相对当前父层的机械代码增删应按 `node scripts/rule-checks.mjs size db6b01df3bfa083a82722a119876c66eefd0f516` 重算，不沿用原父层837行数字。原837行完整修复获人类批准，当前差异增长来自保留已交付UI/展示契约的必要接合，不添加产品需求，不删安全断言或压缩算法。最终整合独立复评、真实browser及当前head的hosted/Ready门仍须完成；#466具体854行预算答复与前层最终发布门独立。


### 2026-11-02 · 接管与逐层合入门

本轮实际直接base为 `bb3539d3ad146ebc697c6afb1b3bdcdc3a6ffad8`；在本分支根执行 `node scripts/rule-checks.mjs disclosure bb3539d3ad146ebc697c6afb1b3bdcdc3a6ffad8`、`node scripts/rule-checks.mjs size bb3539d3ad146ebc697c6afb1b3bdcdc3a6ffad8` 和 `git diff --check bb3539d3ad146ebc697c6afb1b3bdcdc3a6ffad8...HEAD`。早期批次的固定source/base用于重放其历史证据，不作本轮当前判定。

本PR原正式批准与全矩阵证据由 `docs/review/pr-472-mmp-review.md` 承接；本轮用户明确要求接管全部开放PR。每次父层合入后，以真实main/直接父层重新确定replay cut，保留完整已批准产品/测试语义、归档与导航。先建 `refs/backup/pr472-before-approved-integration-20261102`，再检查range-diff、规模、五类发布面与适用验证；仅使用精确旧远端head的lease发布。

在当前分支检出根回读 `gh pr view 472 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviews,closingIssuesReferences`、`gh pr checks 472 -R SingularityKChen/harness-projects` 与全部review threads。新head的独立复评及真实必需checks成立后才执行已授权 `merge_method=rebase`；native stack成员使用仓库已验证的merge-async入口，逐项回读实际MERGED、合入tree和对应issue。旧head批准、dispatch、局部测试或“无冲突”不替代当前head验收。

## Bottom Change Note

- 2026-10-30（Asia/Singapore）：初版；分离完整Delivery读侧后，集中已发货逐步写门、诚实恢复与单carrier真实browser总验收，允许规模事实推动额外完整切片而不减验收。

Change Note (2026-10-30 SGT)：按实际独立反例更新依赖链为 #204→Planning→Delivery→本切片；保留完整 #457 验收，先在不共享区域改唯一 production browser carrier，实际接口稳定后再接逐步权限。A 发现未发货 Core writePlanningStatus 在 redaction 持久失败时未读 runtime 门，本切片需证实 Host allowlist 继续拒绝并评估最小 Core 门，不声称父范围提前完成。

Change Note (2026-10-30 SGT)：记录第一阶段真实 Host carrier 的 RED→GREEN、8/8 本地验证、真实浏览器发现的 setup seed 反例及修复；导出同页场景与 Provider 控制接口，浏览器总验收和逐步门保持未完成。

Change Note (2026-10-30 SGT)：就地取代旧 #204 依赖判断和重试描述；明确新 attempt/key 与 settled receipt/Unknown 边界，记录 root 的旧父层同页浏览器正控及当前内部 options validation seam。

Change Note (2026-10-30 SGT)：第二阶段逐步门、partial ack、immutable receipt、新 attempt 恢复、当前 preflight 与拒权结算失败保真完成本地实现；补真实 Provider 单 key 控制、UI 显式 validation 与隔离副本双负控。最终 B 修复重放、组合独立评审和跨域 browser 总验收保持待办。

Change Note (2026-10-30 SGT)：整合 B f43efcd 持久 read-health 复评修复，补前置门与操作 metadata epoch/ABA 两项 TDD 反例；记录53项组合、2708+7完整验证及当前父层隔离负控。计划保持Active等待同head独立复评、真实browser总验收和远端门。

Change Note (2026-10-30 SGT)：记录独立四反例的RED/GREEN、逐真实读与版本门修复、Unknown保真及完整2719+7本地证据；保持Active等待固定修复SHA独立复评、最终浏览器和远端门。

Change Note (2026-10-30 SGT)：记录固定head独立复评和五PR组合验证；浏览器暴露partial拒权后的旧validation资格，明确确定失败须撤销、Unknown保留原键读回的判据。

Change Note (2026-10-30 SGT)：补最后UI资格修复的独立实施、RED/GREEN及2721项本地回归，保留Unknown/Pending读回并守住772行代码预算。

Change Note (2026-10-30 SGT)：记录2740+7组合与真实同revision gap/恢复证据；补兄弟key冲突的RED/GREEN及795行预算，最终DOM循环与远端门保持待验。

Change Note (2026-10-30 SGT)：归档固定852b089的独立复评、完整真实browser、隔离负控恢复和源head hosted证据；补自包含seed/故障复现，清楚区分最终文档head的Ready回读与R1/UAT。

Change Note (2026-10-30 SGT)：补最终namespace源码与独立#436的2741+7完整组合证据；发布只含文档补录，仍逐字核对产品源码并重读最终远端门。

Change Note (2026-10-30 SGT)：按正式 review 5709139015 与用户条件授权重开 Active，增加 R472-U1 的状态生命周期设计、正规 TDD、独立复评和严格预算门；不重放前层或擅自扩交付预算。

Change Note (2026-10-30 SGT)：R472-U1 有效三项RED后以独立commandGeneration修复，UI16/16、关联185/185及typecheck通过；记录真实837行总代价，未以测试删减或算法压缩规避<800门，等待独立复评和协调裁决。

Change Note (2026-10-30 SGT)：补本批完整主套件2723/2723与三项具名KILLED/逐字还原证据；产品改动冻结供独立复评，837预算仍待裁决。

2026-10-30 修复独立复评：指定另一评审者实际UI16/16、额外反例8/8、typecheck/diff-check通过，R472-U1已解决，无新增问题；产品10A4D、测试33A1D。总代码837超过原800预算，本会话已向人类给出保留完整837行或拆PR两项具体选择，答复未到前不发布最终修复。前层P1仍由原实现会话修复。

2026-10-30：已收到本会话明确837行授权；先前预算待裁决记录 Superseded by Decision Log 本次预算裁决（2026-10-30）。R472-U1独立复评通过；仍待前层修复串行重放、最终浏览器/CI门及归档。

Change Note (2026-10-30 SGT)：本地父层接合及实际生产carrier浏览器验证通过；源码104644e9，完整verify2837+7、独立93+2/4KILLED，真实Unknown metadata保留及同key零新增、partial ack新key恢复、Planning/Delivery降级和Escape/watch卸载已验证。实际872预算已单独提问，答复前保留Active与Draft，不冒用原837授权。

Change Note (2026-11-02 SGT)：按人类继续Ready指令，在最终Planning/Delivery父层上重放且保持本层生产源码；独立99/99、三帧Gate身份保全、完整2877+7及默认真实生产Panel浏览器恢复/卸载smoke通过。记录当前872行与历史837的区别，归档计划并同步索引和正式review。最终文档head的CI/全部线程/双向closing与Ready继续按实际远端回读，不沿用旧head批准，不执行merge。

Change Note (2026-11-02 SGT)：按正式 R5 一次性意见重开 Active；保留此前 Completed/Ready 的固定版本历史归属，新增本批根因设计、TDD、事务/并发与独立复评门。不借旧作者批准放行新版本，不改规划 Status、原生依赖或 UAT/R1。

Change Note (2026-11-02 SGT)：R5实际读拒绝统一进共享读健康，恢复仅完整facts+scope事务ack；保留写门、非permission声明镜像和旧请求/ownership代际。删除的是未调用浏览器导出与无消费者字段，不是实际判别；本计划补齐同等自包含控制步骤和DOM/计数/原键判断。当前1000行、82正式+6原probe通过，等待最终父层组合全量及独立复评。

Change Note (2026-11-02 SGT)：R7 保留新 main 的持久 PR 操作及 UI 接线，按独立反例区分 marker/实际拒读/完整确认版本和 pending cohort。完整初候选 3268+7 与原6probe通过；预算和最终独立复评仍未通过，不借旧1000候选或旧批准发布。

Change Note (2026-11-02 SGT)：source06c90c9/base3c8b8da完成3277+7及原15probe、13具名负控；首写后改用capturedaccessEpoch，扩双Storage普通离线/真实拒读正反，当前实际1074，等待具体74行超硬限裁定，不沿用旧预算。

Change Note (2026-11-02 SGT)：记录本聊天对 source06c90c9 具体1074行的明确例外批准；发现并保留父层跨owner F1独立阻塞，继续修共享Storage判据，不扩大本层授权。

Change Note (2026-11-02 SGT)：R11按独立R10完整C1/C2修复持久marker与本地拒读混序，保全部原测试及新增因果/ABA/token对照；正式3380+7、396窄及原6probe通过，1162为精确直接父层Git实测（原ignored估计1164已订正），新增88预算及当前source复评未完成。

Change Note (2026-11-02 SGT)：记录本聊天对a1a3a88具体1162行候选的人类批准，仅放行该规模，保留当前head独立复评/CI/远端门。

Change Note (2026-11-02 SGT)：记录R11独立85+3+6+2、18具名负控全部通过与1162具体预算批准；协调者最终当前source技术接受与远端门仍保留。

Change Note (2026-11-02 SGT)：完整独立MMP复评APPROVE，原C1/C2 ADDRESSED、无新P0–P3；保留独立126/3/2/6/39/6/9与六负控的执行归属，具体1162预算已通过，技术归档并保留最终head远端门。

Change Note (2026-11-02 SGT)：按最终独立评审补充正式负控重放定义文档，分开作者旧13、新5与独立6原执行来源；新增正式测试重放版仅规范隔离路径/两个killedBy，产品代码不变，保留实际新重放门。

Change Note (2026-11-02 SGT)：正式负控文档三份公开JSON在同产品隔离完整归档新重放13/13、5/5、6/6全部KILLED，基线与逐字还原GREEN；真实command/anchor/指定失败名自包含且来源分开，不用旧日志代替新执行。

可公开的完整定义与隔离命令：[PR #472 具名负控重放定义](../../review/pr-472-mutations.md)。

2026-11-02 SGT：按本会话人类对全部开放PR的直接授权接管收尾；新增实际base重放、恢复引用、精确lease、独立复评与逐PR合并回读门，保留原产品/预算/人验边界。
