# 生产组合浏览器读取与恢复能力 ExecPlan

> 状态：Completed（本地生命周期修复与复测）；独立新 revision 复验及远端 Ready 由协调者继续；创建：2026-11-02（Asia/Singapore）
> 范围：交付 #450 的本地可执行浏览器能力子闭环；持续 CI 接线另一个规则 PR，#450 尚不关闭。
> 规范：`PLANS.md`。本计划同时承载最终 spec 与实施批次；每批更新活章节。

## Purpose / Big Picture

维护者运行 `pnpm test:browser`，在无真实凭据、无外网业务调用的 Chromium 中点击真实产品 UI，能判定工作区创建、非空读取、详情导航/焦点、断连、代际恢复与撤权是否保持正确。测试调用生产 Host/controller/client/store，不能以手写 snapshot 冒充端到端证据。完成本层使用 Closes #498 并 Refs #450；只有后继 CI 层交付后，才具备 #450 全部验收证据。#451、#143、#449 和 R1 独立保留。

## Context and Orientation

在分支 `test/composed-workspace-browser` 的工作树根运行，仓库相对目录 `.worktrees/composed-browser-read`。直接父层是 #472 的 `fix/operation-runtime-browser`；2026-11-02 观察的冻结 base 为 `b48dc2398c5d482a5ef028814e9e211a3c4ef040`，协调者已报告该 base 的 typecheck 与 runtime-access-browser 4/4 通过，此处不把它当本层测试结果。执行前 `git rev-parse HEAD`、`git status --short --branch` 并回读父 PR 当前 head；父层变化则先由协调者重基并更新此计划。

共享载体 `tests/fixtures/execution-drawer-browser.mjs` 已使用临时 SQLite、`createHostComposition`、`installHostRemote`、`OPERATIONS`/`parseInput` 严格 unary bridge 和真实 `/watch` NDJSON。浏览器 ENTRY 调用生产 `apps/harness-plugin/src/client.ts` 的 `apply`，最终经 `openWorkspaceWatch`、client supervisor/createSync/createEntityStore 驱动 React。它目前默认预种工作区与执行上下文，Provider permission seam 只有 development/delivery/execution；需要补 empty 与 planning 边界。showcase 场景会提供视觉专用数据，本验收禁止进入。

`packages/ui/src/work-item-app.ts` 为无地址栏宿主使用局部 path/hash href。Web canonical/history 属于真实 `browserHistoryPort`、`createItemNavigation` 和 `WorkItemProjectPage`；测试不得擅自改变插件导航。现有 VM/SSR contracts 保留狭义证据角色。`scripts/run-test-layer.mjs` 能拒绝空文件集、tests-skipped-todo=0 和解析失败，沿用其 Node test 协议。

## Design / Spec

选择 Node test runner + dev-only `playwright` library + 匹配 Chromium。浏览器 locator 自带动作等待，读数使用有界 DOM condition；Node assertions 和 fixture 生命周期继续沿用仓库 runner，避免第二套测试发现/非空报告协议。放弃 Playwright Test 方案的理由是当前已有可复用非空 runner；同时必须自行提供失败截图、trace 与 context 清理。放弃常驻/预装 Chrome：其版本与存在性不能成为测试契约。

唯一 server 支持 `seed: 'empty' | 'read'` 初始化。empty 用全新临时 SQLite 和真实 Host setup，浏览器点击生产创建工作区，随后从 installed Host 和存储回读唯一工作区；不预造 setup response。read 模式可从 Fake Provider 种入确定的非空 Issue/Draft/redacted 数据；不 seed client store。原导出和默认模式保留现有 #472 用例，不作重命名或兼容适配器。

控制面只允许 mounted Provider fault/permission、暂停真实返回、释放 barrier、物理断连、同数据库重建真实 Host/new peer，以及计数/descriptor 只读 inspection。planning 撤权通过 Provider describeCapabilities 与读方法拒绝共同生效，不改 snapshot 值。hold 返回 entered/held 计数，测试先等待已进入再撤权/重连，再 release；禁止固定 sleep 证明并发顺序。原先用第二个 refresh 在 held Provider 返回前观测撤权的并发假设，Superseded by Decision Log 的单飞与 transport hold 裁决（2026-11-02）。重建须 dispose 旧 installed service/Host、用同数据库新建并挂载、重新连接真实 watch；generation 从生产 Core 获取，不能 fixture 自增。

保留生产 apply 主入口覆盖真实创建、列表、抽屉及恢复。另在同一 server 上提供 Web history 入口：真实 `browserHistoryPort` + `createItemNavigation` + `WorkItemProjectPage`，消费真实 Host stream 驱动的一个生产 sync/store；不手写业务 read，不并行保持第二份权威 store。每个页面入口各自的生产订阅在卸载时释放。浏览器 history 证据只归 Web adapter，不能写成安装 Harness 有 Back。

命名测试组为 create workspace、nonempty read/detail focus、canonical history/deep link、disconnect/reconnect、held old response/real Host generation、permission withdrawal/late canary。每组有正控：确认真实非空标题/正文已出现、Host operation/Provider 被调用，才制造故障。撤权后检查 DOM/可访问文本和重新打开详情/Back/重连均无 canary；恢复权限只有新权威读后重新显示。普通物理重连不允许修订倒退，新 Host generation 可接受合法新 baseline。全组禁止 skip/todo/only。

## Global Constraints

所有产品身份、权限、原子性、owner 围栏、持久意图、Provider 确认、unknown/conflict 和恢复语义保持。没有正式发布，不增加实验 API/旧数据库兼容层、双写或静默迁移；旧库拒绝与备份保留。Host 是业务权威，规划状态与工程事实正交。agent 不合并 PR、不改 Project Status 或 native blocked-by/blocking，不调用真实模型或执行真实 GitHub 业务写入。

每个 PR 对其**直接 base**计算增删总和：代码、测试、配置、fixture 严格少于 800 行，文档严格少于 1300 行；锁文件按仓库政策排除但仍审查。仓库 size 脚本的 1000/1500 上限不足以证明本轮要求。新发现的产品缺陷单列证据交所属 owner，不能通过减弱测试、权限或事实边界满足行数。发布面不得含凭据、本机绝对路径、访问型会话 URL 或内部系统资料。

本层唯一写集：`tests/fixtures/execution-drawer-browser.mjs`，必要的 `tests/fixtures/composed-workspace-browser.mjs`（仅编排/页面 entry，不新 server/业务权威），`tests/browser/workspace-read.test.js`，根 `package.json`/`pnpm-lock.yaml`，本计划、`tests/browser/README.md`及必要独立评审记录。所有权不含 `.github/workflows/`、CI mapping contracts、`docs/development/ci.md`、产品 packages/apps 源码或既有 #466/#469/#472 工作树。目标代码 460–730、文档 220–430 行，预估不是验收。

## Plan of Work

### Batch 1 · 固定本地浏览器入口并取得 RED

先提交本计划并由协调者创建 Draft PR，回读 head/base/draft/文件范围与 issue 关联，再开始实施。公开写入只由协调者执行；使用 Closes #498、Refs #450，回读 closingIssuesReferences 必须包含子项且不包含父项。已创建子项的事实与 ack 见 Decision Log；不提前关闭父项。

最终提交前收敛本地 commits，检查消息、diff、发布面和严格规模；已推历史如需整理，先建 backup ref，再由协调者按 git-expert-operations 使用精确 lease。最终 push 后回读当前 head/base/checks、closingIssuesReferences 和全部 review threads；只有当前 head 的独立验收与真实 hosted checks 通过才 Ready。Ready 是请求人类评审，不是合并、规划完成或发布。

本批主文件是 `package.json` 与 `tests/browser/workspace-read.test.js`。运行 `pnpm add --save-dev --workspace-root --save-exact playwright`，记录实际精确版本、锁文件与安装耗时；定义 `test:browser` 为 `node scripts/run-test-layer.mjs tests/browser "生产组合浏览器读取与恢复"`。不把 browser 放进普通 pnpm test/verify。执行 `pnpm exec playwright install chromium`，安装失败或 binary 缺失应明确失败，不 fallback/skip。

先写上述 named 用户用例，指向尚未实现的 empty/planning/rebuild seams，运行 `pnpm test:browser` 取得具体行为 RED。不能把包导入失败当作行为 RED。同一 suite 全 skip 或临时空目标时，runner 必须非零。

### Batch 2 · 单载体与用户观察闭环

本批主文件是共享 fixture 和 browser suite。补初始化、规划 Provider barrier/permission、真实 Host 重建与 Web adapter entry，然后逐组使 RED 复绿。每例全新临时数据库、随机 loopback 端口、BrowserContext，所有非 loopback 请求 abort 并计为测试失败；服务只监听 `127.0.0.1`。测试命令启动后不下载依赖/浏览器、不调用模型或真实 GitHub。单例 Node test timeout 60 秒，外层 describe 显式 timeout 120000 毫秒；现有layer runner本身不提供该截止，不能误称已有保护。超时须abort载体并清理，若实际超预算先找泄漏/等待机制，不放任无界执行。只在失败时保留 `test-results/composed-browser/` 截图/trace，使用生成的可公开数据。

每例 finally 关闭页面/context/browser，释放 held Promise、abort 流、dispose Host、关闭 SQLite/server 并仅清理本例 mkdtemp 目录。不能删除用户工作树。

### Batch 3 · 对抗验收与交付

在本分支根执行 `pnpm install --frozen-lockfile`、`pnpm test:browser`、`pnpm test:file tests/e2e/runtime-access-browser.test.js`、`pnpm verify`、`pnpm run boundaries`；期望真实 browser named 组均执行、fail/skip/todo=0，既有 carrier 用例和其余检查通过。依赖配置变化要求 verify，不把 browser 的本地绿写成 hosted lane。

隔离 archive/临时检出内分别删除真实 navigate dispatch、去掉生产 snapshot 接受围栏、去掉撤权 redaction/fence；其中 snapshot 单 guard mutant 要求 Superseded by Decision Log 的可达代际契约裁决（2026-11-02）：采用真实 Core generation 唯一性变异，不能称为已杀死旧 snapshot guard。先确认 mutant 非空 diff，再跑各自相关组，必须以行为断言失败，逐字还原并复绿。至少一个 late-canary mutant 必须在先可读后撤权且旧响应已进入 barrier 的顺序下失败。另验证缺 Chromium、空 suite、全 skip 均失败。记录具体注入点/命令/输出，临时 mutant 不提交。

发布面与规模命令的直接 base 是 `b48dc2398c5d482a5ef028814e9e211a3c4ef040`；重基时须同步更新，不以累计 main 计算此层：

    node scripts/rule-checks.mjs disclosure b48dc2398c5d482a5ef028814e9e211a3c4ef040
    node scripts/rule-checks.mjs size b48dc2398c5d482a5ef028814e9e211a3c4ef040
    git diff --check b48dc2398c5d482a5ef028814e9e211a3c4ef040...HEAD
    git diff --numstat b48dc2398c5d482a5ef028814e9e211a3c4ef040...HEAD

以上命令使用本观察的直接 base 对象；重基后同步改成新的具体 SHA，不用累计栈底。把 numstat 的新增与删除相加，Markdown 计文档，其余受策略计数文件计代码；必须实际记录两项数值并分别验证 <1300、<800，不能只引用较宽脚本通过。

回滚点：独立 revert 本层提交即可恢复 #472 载体和普通非浏览器测试；后继 CI PR 未撤回前不可先移除其命令。

## Validation and Acceptance

| 验收 | 可判定证据 |
|---|---|
| UI 创建是真实持久命令 | 浏览器 click 后 createWorkspace 请求非零、Host/SQLite唯一工作区；空名拒绝无半成品 |
| 非空列表/详情/焦点 | Issue/Draft/redacted身份，真实 opener→dialog→Escape/关闭回焦 |
| canonical/history | 同 Host/sync 的 Web entry：链接、Back/Forward、deep-link/reload及scope拒绝 |
| 断连/代际 | 列表与详情 stale；普通重连不回退；真实 Host 重建合法代际；held旧响应不覆盖 |
| 撤权/迟到 | 可见正控→Provider拒绝→canary消失，late/Back/reopen/reconnect不复活；新权威恢复读才显示 |
| 可重复且不可假绿 | 无业务外网/凭据；empty/all-skip/missing-binary失败；截图/trace；mutant红→还原绿 |
| 边界与交付 | 原 #472 用例不退化；严格规模/发布面；当前远端验证通过后Ready，仅Refs450 |

## Progress

- [x] (2026-11-02 16:18 +08) 独立修订者读取两份完整方案并收敛此计划；确认 browser→#472 的真实依赖与CI后置。
- [x] (2026-11-02) Batch 1：协调者已创建 Draft #503 并回读双向 Closes #498；本层 exact dev-only Playwright 1.64.1，安装 22.2 秒，匹配 Chromium 156.0.8078.4。首次真实浏览器 RED 为旧 seeded 载体缺少工作区名称表单；其后 Draft、Web 路由、断连与代际的缺失行为均实际 RED，日志在 `.superpowers/composed-browser/`。
- [x] (2026-11-02) Batch 2：六个 named Chromium 场景执行，观察运行 `pnpm test:browser` 为 6 pass、0 fail/skip/todo，约 9.47 秒；工作副本基于 `test/composed-workspace-browser` 的已提交计划 head，最终代码由协调者整理提交。真实 baseline 的 item.accept 回调只读记录 generation/revision，重建断言读取实际接受帧。
- [x] (2026-11-02) Batch 3 原本地完成结论 Superseded by Surprises & Discoveries 的 100ms 生命周期反例与修复（2026-11-02）；本地修复与完整矩阵复测完成，等待独立新 revision 复验；提交整理、远端当前 head/checks/关联/threads 回读及 Ready 由协调者单独执行，未在本层冒称完成。
- [x] (2026-11-02 16:18 +08) 已确认#450持续CI层是后继规则PR责任，不阻止本地能力子项独立归档。

## Surprises & Discoveries

独立验收把创建场景的 Node timeout 从 60000ms 暂改为 100ms，Node 报超时后仍须 12 秒外部看门狗终止。作者在 `test/composed-workspace-browser` 的 `d10af23` 重现：server acquired → browser launch 开始 → cleanup 见 browser/context/page 均未赋值并已完成 → browser/context/page 随后全部取得，watchdog exit 124。根因是 memoized cleanup 只清理当时的变量，且 after/abort hook 晚于 server acquire 注册；“finally/abort 已足够”原结论 Superseded by Decision Log 的资源 adoption 修复（2026-11-02）。底层 Chromium launch 另设 7000ms 上限，未取得 handle 的启动失败也有有界收尾。另以 1ms 创建场景 timeout 验证 server 尚在取得时的取消，修复后自行 exit 1/0.53 秒。原始 RED 位于 `.superpowers/composed-browser/lifecycle-red.log`。

原载体 inspect 假定已有 execution Provider，empty 模式须容许零挂载；生产 empty UI 自动进入创建表单，创建后返回摘要，隐藏的设置表单仍在 DOM，因此可见断言须选择实际可见元素。Fake Provider addItem 生成实际外部身份 `item-new-6`，Draft 标题不是其 externalId，断言保留两者区别。

main 的旧 carrier 自造 baseline/generation，不能满足 #450；#472 已改为真实 watch 与严格 OPERATIONS，故采用真实 stack。该父层仍不足：默认已种工作区与执行，且 planning 不在 permissionMethods 中。生产 WorkItemApp 是宿主局部导航，Web history 必须单独验证真实 Web adapter，不改产品来迎合测试。

## Decision Log

- 2026-11-02 SGT：本轮仅docs/README.md冲突，按实际main保留所有索引项并加入本层；将四条已指向completed文件的旧Active记录移至Completed，未修改计划内容或产品事实。carrier自动合并，后续必须在新权限实现上跑真实浏览器与适用核心回归。

- 2026-11-02 SGT · 全部开放PR接管：本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。本授权明确覆盖当前PR #503，由本评审会话接管修复/独立复评、实际base重放、当前head门禁、issue核对及rebase merge。旧阶段“不merge/仅Ready”的限制仅在合并授权上 Superseded by 本决策；技术、范围、预算、凭据与人类UAT/R1门保持。Planning Status及native依赖关系仍不写入。

- 2026-11-02：本会话用户直接对 #501–#504 条件授权无P0/P1时由评审会话完成独立复评、归档、提交整理和issue核对后rebase合并；不授权其它PR合并或Planning字段写入。本项虽无新增阻塞，必要上游 #472 的Draft及既有阻塞仍由其owner闭合，不能越过。

Decision：在任意 server/browser/context/page acquire 之前注册生命周期；每次 adopt 在 await 前查 abort，await 后若已 closing/aborted 就立即关闭晚到资源并拒绝，不创建后代；close 先进入吸收态，再按逆序尝试全部已 adopt 的释放，即使一个释放失败也继续其它释放并汇总错误。Rationale：修复实际所有权竞态而非延长 timeout；新增实际 server/browser/context/page 四阶段 barrier 回归，不依赖 sleep。相同 100ms 负控现在 exit 1、首次约 0.63 秒、最终补测约 0.57 秒自行退出；六业务场景加一生命周期回归 7/7。独立复验仍待协调者。Date/Author：2026-11-02 / 实现者。

Decision：Provider list 被 hold 后，第二个 remote refresh 在同 epoch 只 join 原 flight；采用真实 baseline transport hold：先有非空 canary，再等 held>0，经 Provider 撤权与生产 refresh 提交拒读，新 watch 先显示权威拒读，最后 release 旧返回并检查 DOM/AX、重开、Back 与重连。Rationale：符合生产单飞语义，不调用私有 Core 或修改 snapshot；协调者明确批准此修订。Date/Author：2026-11-02 / 实现者与协调者。

Decision：真实 installed remote dispose/HTTP abort 已阻止 held 旧返回交付；supervisor 终止旧 follower 后以新 store 重开。仅删除 sync 的低 revision guard 在这些合法流中不会破坏性质，不能据此造不可能流杀 mutant。采用 controller 每 Core generation 改成固定合法 UUID 的隔离变异，证明真实重建代际唯一性；它不是旧 snapshot 接受 guard 的已杀死证据。Rationale：协调者对可达路径裁决的明确批准，保留两道独立保护的真实边界。Date/Author：2026-11-02 / 实现者与协调者。

Decision：吸收方案 B 的 Node runner/library 与方案 A 的真实同载体 Web history、empty/代际/撤权要求；不采用第二 runner或预装Chrome。Rationale：复用现有非空协议且不减少真实DOM与失败证据。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision：按 docs/review/README.md §6 把browser能力和CI规则拆为两PR。Rationale：能力可本地独立使用/撤销，规则层改变持续调度与必需聚合输入；不是为行数机械拆分。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision / 外部写入记录：协调者报告并提供回读：actor `SingularityKChen`，目标 `SingularityKChen/harness-projects` 的子 issue #498，父项 #450；创建与subissue链接已ack并回读，Project item已建立；未改Status/native依赖。独立修订者未执行远端写入。创建请求幂等记录由协调者在最终交付审计中补入，不凭空构造。Date/Author：2026-11-02 +08 / 协调者执行、独立修订者记录。

## Idempotence and Recovery

每次测试重新 mkdtemp，控制 release/dispose 可重复，异常也走 finally。安装按精确 lockfile重复；禁止全局浏览器会话、共享库或用户库。父栈更新先冻结本层工作，协调者保留恢复锚点并重基，不修改父owner工作区。发现产品反例时保留RED和issue证据，交所属owner修复后再恢复验收。新增延迟工作的可靠性/维护性风险记 `docs/exec-plan/tech-debt-tracker.md`；#451等既有范围不伪装为本层新债务。

## Interfaces and Dependencies

依赖冻结 #472 的真实 Host remote/watch、已有 SQLite/Provider/React/esbuild，以及 exact dev-only playwright+匹配Chromium。Provider seam提供 empty/read 初始化、fault/permission、hold/entered/release、rebuild/inspection；不得提供 setSnapshot。CLI契约固定为 `pnpm test:browser`，非空Node summary失败协议与失败产物路径供后继CI消费。后继 `.worktrees/composed-browser-ci` 仅在本层最终head后创建，避免两层过早共享重写。

## Outcomes & Retrospective

本层已实现本地生产组合浏览器能力；原归档结论因生命周期反例复开，adoption 修复已经本地复测；按协调者指令归档本地闭环，仍待新 revision 独立复验。下表命令均在检出 `test/composed-workspace-browser` 的工作树根运行，测试执行的是该分支待协调者提交的工作副本；不是 hosted CI，也不是最终远端 head 的验收。运行态原始输出在 `.superpowers/composed-browser/`，没有复制绝对路径到正式文档。

| 实际命令/隔离变异 | 观察结果 |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0；新依赖只有 exact dev-only `playwright@1.64.1` 与其 matching core |
| `pnpm exec playwright install chromium` | exit 0；实际 Chromium 156.0.8078.4；缓存已具备匹配二进制，本次准备未下载业务数据 |
| `pnpm test:browser` | 修复后六业务场景加四阶段生命周期回归，共 7 pass，fail/cancel/skip/todo=0，最终约 10.02 秒（`lifecycle-frozen7.log`）；原六组结果是修复前历史证据 |
| `pnpm test:file tests/e2e/runtime-access-browser.test.js` | 4/4 pass（`carrier-final.log`） |
| `pnpm verify` | 修复后重跑 typecheck、2877 tests 与 7 MVP 检查全绿；0 fail/skip（`lifecycle-verify.log`） |
| `pnpm run boundaries` / `node scripts/workflow-check.mjs` | 9/9 pass；8 workflow 文件无 findings |
| 隔离删除 `packages/ui/src/item-route.ts` 的 `port[kind](path)` | canonical history 组先见非空列表，再因打开详情失败而 RED；exit 1 |
| 隔离将 `packages/controller/src/queries.ts` 的每 Core 随机 generation 改成固定合法 UUID | 重建组的实际 accepted 帧没有新 generation 而 RED；exit 1 |
| 隔离将 `packages/core/src/runtime-access.ts` 的 `deny` 改为维持 false | 先可读→旧真实 baseline entered/held→撤权后 canary 未消失而 RED；exit 1；没有伪造业务帧 |
| 隔离只移除 `packages/client/src/sync.ts` 的低 revision baseline guard | 6/6 仍绿，因实际 dispose/abort 与 follower 重开已经阻止旧响应交付；这是存活 mutant，不能算 killed |
| 逐字还原隔离产品文件后 `node --test tests/browser/workspace-read.test.js` | 生命周期修复后再次执行三原变异各 exit 1；逐字还原后 7/7 pass，约 8.17 秒；mutation patch 均非空，正式树产品无改动 |
| 空目录与全 skip 经 `scripts/run-test-layer.mjs` | 各 exit 1；分别报告空层和 tests=1/skipped=1/执行0 |
| `PLAYWRIGHT_BROWSERS_PATH=.superpowers/composed-browser/no-browser pnpm test:browser` | 修复后 exit 1，7 fail、0 skip；明确 missing executable，完成清理后进程退出 |
| 临时将创建场景 Node timeout 从 60000ms 改为 100ms，再以 12 秒看门狗运行该具名用例 | 修复前 exit 124/12.01 秒；修复后自行 exit 1/0.57 秒，报告预期 timeout，恢复正常 timeout 后 7/7；临时副本不提交 |

当前工作副本相对直接 base 的 tracked+untracked 增删和实测：代码/测试/配置 347 行，文档 183 行（锁文件另审），均严格低于 800/1300；机械新增行扫描无命中，人工五类目未见真实凭据、本机身份、个人信息、内部系统或保密资料。最终 commit 与协调者索引更新后仍须重算。

失败截图/trace 已由首次 RED 和隔离 mutants 实际产生；`.gitignore` 已忽略 `test-results/`，没有新增生成物到源码。正式工作树仅测试、fixture、package/lock 与文档变更；父 #450 持续 CI 缺口由后继 PR 承担，#451/#143/#449/R1 保持独立。没有产品缺陷修复夹入本层。提交后的公开面脚本和精确规模需协调者对最终 commit 重跑，未将仅检查旧 HEAD 的结果冒充本次工作副本。


### 2026-11-02 · MMP 独立评审与依赖门

完整P0–P3矩阵、实际测试、变异归因、反例与已有issue边界见 `docs/review/pr-503-mmp-review.md`。独立评审未发现本层可归因的P0/P1/P2/P3；原产品/测试/配置blob保持，只并入评审与收尾记录。#472仍由另一会话处理其阻塞，故本层批准不代表整栈或main已可合入。#143/#449及R1保持人类门。

当前head/base/CI和关联必须在最终push后回读：在本分支根运行 `gh pr view 503 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,baseRefOid,reviews,closingIssuesReferences`、`gh pr checks 503 -R SingularityKChen/harness-projects`，另回读全部review threads和同SHA的commit check-runs。非main普通PR未投影的检查不能由dispatch冒称自动触发证据。上游完成后必须在实际新base重放、完整复评并取得新head门禁，再按已授权rebase收尾。恢复引用 `refs/backup/pr503-before-mmp-review-20261102`；发布采用精确lease。


### 2026-11-02 · 接管与逐层合入门

本轮实际直接base为 `4c30c1092524daba44346caf6a3bbf7c68cb49b1`；在本分支根执行 `node scripts/rule-checks.mjs disclosure 4c30c1092524daba44346caf6a3bbf7c68cb49b1`、`node scripts/rule-checks.mjs size 4c30c1092524daba44346caf6a3bbf7c68cb49b1` 和 `git diff --check 4c30c1092524daba44346caf6a3bbf7c68cb49b1...HEAD`。早期批次的固定source/base用于重放其历史证据，不作本轮当前判定。

本PR原正式批准与全矩阵证据由 `docs/review/pr-503-mmp-review.md` 承接；本轮用户明确要求接管全部开放PR。每次父层合入后，以真实main/直接父层重新确定replay cut，保留完整已批准产品/测试语义、归档与导航。先建 `refs/backup/pr503-before-approved-integration-20261102`，再检查range-diff、规模、五类发布面与适用验证；仅使用精确旧远端head的lease发布。

在当前分支检出根回读 `gh pr view 503 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviews,closingIssuesReferences`、`gh pr checks 503 -R SingularityKChen/harness-projects` 与全部review threads。新head的独立复评及真实必需checks成立后才执行已授权 `merge_method=rebase`；native stack成员使用仓库已验证的merge-async入口，逐项回读实际MERGED、合入tree和对应issue。旧head批准、dispatch、局部测试或“无冲突”不替代当前head验收。


### 2026-11-02 · 新权限栈上的实际整合验收

实际source `bdd4c6cc996f18f885d3ad2fdcabc358c4eb8106`、base `4c30c1092524daba44346caf6a3bbf7c68cb49b1`，在本工作树由独立评审者执行：`CI=true pnpm install --frozen-lockfile` exit0；`pnpm verify` 为typecheck及3380主测试+7 MVP0；`pnpm test:browser` 7/7；原carrier4/4、C1/C2窄回归7/7、boundaries9/9，全部无fail/cancel/skip/todo。carrier/suite/Web入口/package/lock与原152e逐字相同，权限实现继承已合入R12父层；独立结论APPROVE、无新增P0–P3。先前“全部非docs对象与初审相同”的旧整理结论只对应原固定parent，不能套用于本次父层更新；本轮以新父层及上述实际组合验证为准。

仅docs/README.md发生冲突；保留全部原索引和本层入口，并移动四条已完成计划的分类。浏览器相关具名负控保留其原source执行归属，本次没有冒称重跑全部旧负控。最终证据文档并入后仍需核对新head独立复评、真实hosted检查和全部线程/issue，再执行授权rebase merge。

## Bottom Change Note

2026-11-02 16:18 +08：第三独立agent在两完整设计后收敛；采用单carrier、Node runner与真实Web适配器，严格拆出后继CI规则层，保留全部原AC及父项边界。

2026-11-02 +08：第二遍语义审读明确test README写集和Node suite显式截止；修正现有layer runner自带120秒保护的错误假设。

2026-11-02：实现共享 empty/read、规划权限、真实 Host 重建与同 sync Web 入口；记录六场景 RED→GREEN、实际 driver/browser 版本、单飞及可达 mutant 裁决。

2026-11-02：本地能力六组、常规验证及隔离负控完成，归档；明确低 revision guard mutant 存活、真实代际唯一性负控及后继 CI/远端 Ready 责任。

2026-11-02：独立验收揭示 100ms 取消时晚到资源泄漏；作者复现 RED 后修复资源 adoption/吸收态清理，并加入真实四阶段回归。复开计划，等待独立复验，不以正常六场景绿代替取消证据。

2026-11-02：本地生命周期修复、同样 100ms/额外 1ms 负控、真实四阶段获取回归、三原 mutant 复跑及还原 7/7、常规矩阵均完成；按协调者指令归档并冻结作者树。新 revision 的独立 P1 复验和远端门禁仍由协调者完成，未提前宣称通过。

2026-11-02：补充本轮MMP独立评审、用户条件授权及必要上游依赖门；保留真实反例和未验人类边界，不把本层批准写成整栈接受。

2026-11-02 SGT：按本会话人类对全部开放PR的直接授权接管收尾；新增实际base重放、恢复引用、精确lease、独立复评与逐PR合并回读门，保留原产品/预算/人验边界。

2026-11-02 SGT：记录真实新main上的完整verify、Chromium/载体/因果窄回归与独立复评，区分旧父层blob等价和本轮实际组合；最终文档head托管门保留。
