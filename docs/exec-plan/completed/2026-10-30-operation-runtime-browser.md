# 已发货操作运行时准入与生产浏览器验收 ExecPlan

> 状态：Completed；创建/产品验收：2026-10-30（Asia/Singapore）。交付Ready须按Batch 4对最终head回读。
> 范围：Start Work 各外部步骤的当前权限门、安全恢复解释、唯一生产 browser carrier 与 #457 总验收。
> 关联：Closes #457；Refs #465、#468；只有 A、B 与本切片原验收全部成立才由关联 PR 关闭 #457，closingIssuesReferences 回读为准。
> 实施位置：所属工作树 `docs/exec-plan/completed/2026-10-30-operation-runtime-browser.md`，遵循根 `PLANS.md`。

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

浏览器场景必须可重复执行：测试模块导出步骤与断言，配合本机可用的 browser 自动化工具执行；记录启动命令、head、测试选择、DOM canary、观察结果与截图。Node 静态 HTML 或手工点击叙述不能单独冒称真实 browser。

## Global Constraints

文件集：`packages/core/src/runtime-access.ts`（仅已发货写观察/validation 接入）、`packages/core/src/git-provisioning.ts`、`packages/core/src/start-work.ts`（只接逐步门，协调 #204 共享片段）；必要 `packages/core/src/queries.ts`、`packages/core/src/context.ts`、`packages/core/src/status-policy.ts` 与 `packages/controller/src/commands.ts`；`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host-operations.ts`（仅既有 options/submit 参数接线）；`packages/client/src/start-work.ts`；`packages/ui-model/src/work-item-detail-view.ts`；`packages/ui/src/start-work-section.ts`、`packages/ui/src/work-item-detail.ts`；新 `tests/integration/runtime-operation-access.test.js`；既有 `tests/contract/harness-host-operations.test.js`、`tests/integration/harness-plugin-runtime-access.test.js`、`tests/integration/harness-plugin-execution-drawer.test.js` 的必要断言；唯一 `tests/fixtures/execution-drawer-browser.mjs`；新 `tests/e2e/runtime-access-browser.test.js` 与 `tests/fixtures/runtime-access-browser-scenarios.mjs`；`tests/contract/ui-start-work.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/integration/harness-plugin-start-work.test.js`、`tests/integration/start-work-sqlite-registration.test.js` 的必要断言；本计划及 `docs/README.md`。接口稳定后的具体差异先更新本节，禁止同 owner 区域并行写。

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

隔离负控撤去 runtime owner 的拒读观察，使真实query继续投影旧事实；实际browser的相同title/body canary必须失败，再逐字恢复并重跑。这个负控比只改HTML更贴近授权根因；实际执行见本节最终证据。不能用只隐藏按钮的负控替代。回滚 fixture/test coherence，已存在 A/B 安全实现保留。

2026-10-30 第一阶段本地证据：在 `fix/operation-runtime-browser` 的 `2f04105` 上，仅修改 fixture、新增浏览器桥契约和导出场景，未进入 Core/UI 的并发区域。`pnpm test:file tests/e2e/runtime-access-browser.test.js` 先因真实 `/remote` 与 `/watch` 未实现而失败；替换后新三项桥契约、既有三项 drawer 正控与两项 runtime access 集成共 8/8 通过。新增 `getWorkspaceSetup` 的 `confirmed` 断言进一步复现旧 seed 缺真实 `projectNodeId` 导致页面困在 setup，已通过 SQLite `putBindingConfiguration` 和受信 fixture schema 补齐，未覆盖 Host setup 返回。运行命令使用仓库固定的 pnpm 10.28.2。

浏览器复现入口仍是 `node tests/fixtures/execution-drawer-browser.mjs`；页面挂载后 `window.fixture.command(action,value)` 仅控制 mounted Provider `fault`（`domain/kind/enabled`）、真实 Provider Promise 的 `hold`（`domain/method/enabled`）和 `release`。`inspect` 返回请求记录与活动 stream/held 计数；`status` 是既有非权限执行正控 seam。`window.fixture.remote` 是从 `OPERATIONS` 推导的全部 unary，HTTP `/remote` 以 `{name,input}` 转调真实 installed service，`/watch` 透传真实 installed watch。`tests/fixtures/runtime-access-browser-scenarios.mjs` 导出同页操作步骤与实际 DOM 文本断言，浏览器由协调者集中执行；当时真实浏览器矩阵仍待验证；Superseded by 本节最终证据（2026-10-30），不以Node通过替代。

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

既有 frozen route 同时携初始 capability 快照，故其身份稳定性不证明当前授权；Execution resolve 后仍有 await，门必须贴实际副作用。已有 client `StartWorkResult` 丢弃 error，泛化“失败可重试”不能完成 key/layer 解释。

既有 browser `$stream` 将手工 baseline 包装为新 generation，controller visibility 也被覆盖；这只证明展示守卫，不证明生产权限。替换会同时计删除与新增，C 的规模风险主要在此，必须保留实际 diff 准入门。

实际浏览器首先暴露旧 fixture 虽有投影但没有持久 `BindingConfiguration.projectNodeId`，导致 Host 真实 setup 状态为 `degraded`，页面无法进入列表。直接 unary/watch 契约此前未覆盖 setup 准入，新增真实 setup 断言后修复 seed；不能从 baseline 含业务行推断生产页面可达。

独立反例还证明：descriptor 成功仅是读取时的声明，不能覆盖 await 期间更新的实际拒绝；前置准入也不能覆盖之后的真实读。故逐真实读 guard 仅包装 getRepository/listBranches/getWorktree/preflightWorktree 四个既有方法，不新增权限账本。Unknown 不是确定失败，必须先保留原 receipt 再表达当前不可继续条件。

## Decision Log

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

最终产品源码锁定 `852b089c40b99c39c24efc2b82fc2a37ab18d207`，直接父层 `f64e51446bd9fb07cdd899befd9d604f09a8a696`。四个Core反例、UI资格和兄弟key两项均由独立实施/限定复评闭环；无开放的本切片阻断finding。两套Storage探针及26操作用例、最终UI26用例通过；最后namespace前的完整五PR组合为2740+7，namespace后的同源码hosted Verify/Integration/E2E/Boundaries/MVP-0/CodeQL/PR Fast Gate均成功。 最终namespace源码再与独立#436组合，在检出`test/core-delivery-integration`（`1ce66a1cd64f511fb831d5e106aafc69b2b54607`）的工作树根执行`pnpm verify`，主套件2741/2741及MVP0 7/7通过。命令 `gh pr view 472 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup` 可重算，不能把源head结果套到最终文档head；最终文档归档commit必须证明packages/apps/tests与源head逐字相同，再重新回读远端。

实际browser在该固定源码上完成Planning offline/denial/recovery/late成功、Delivery offline/逐key denial/recovery、写拒绝/显式validation/partial ack/新key恢复/旧key重放，以及gap重开、键盘进入/Escape/Tab、role=status和卸载。无真实凭据的fake Providers与临时SQLite是证据边界，不是已安装Harness、人类UAT、真实GitHub撤权或R1。本PR只提出关闭#457；完整#144、#193、#421、#458与R1保持独立。技术债tracker已复查，本切片未以预算为由接受新延期。

### Artifacts and Notes

原始日志、截图和负控只保存在任务运行态目录；本计划维护真实命令、分支、head 和结果。

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
