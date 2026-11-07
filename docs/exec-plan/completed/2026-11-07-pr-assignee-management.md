# 给已确认 PR 添加原生负责人 ExecPlan

> 状态：Completed；创建：2026-11-07；关联：Closes #567；Refs #557（当前已确认 PR 的负责人选择、添加和读回叶子）。本计划遵循根 `PLANS.md`；仅完成本叶子不会关闭创建前预选的父项。

## Purpose / Big Picture

用户在当前工作项、仓库的已确认 PR 下选择仓库允许的负责人，点击“添加负责人”，看到同一个 PR 的原生读回确认。授权失败或网络不确定时 PR 仍然已创建，负责人单独显示被拒绝或待确认；重载只核对原 PR，不创建第二个 PR。

最小证据是生产 Host/client/UI 组合完成选择和添加，SQLite 重开后只读恢复丢失确认的结果，PR create 调用不增加、assignment mutation 至多一次，规划状态和关系全快照不变。

## Context and Orientation

研究基线是 `45330b54`。`packages/core/src/create-change-request.ts` 已用 MutationAttemptRecord（持久命令记录）保存 create 指纹、context generation 和 confirmedRef；`resolveOperation` 验证当前目标与授权，`matchesPrTarget` 比较上下文。`packages/capabilities/src/storage.ts` 的 externalIntentSnapshot 是 Fake/SQLite 共同持久白名单，新增意图必须进入这里。`packages/core/src/context.ts` 和 `queries.ts` 装配命令与纯本地查询。

`ChangeRequestCreator` 经 `apps/harness-plugin/src/client.ts` 注入现有创建区；当前 `CreateChangeRequestSection` 仅有 base/title/body/draft，在 saved/currentTarget 的原操作下可以挂本叶子的消费者。GitHub adapter 通过 GraphQL transport 读写；原五段 DEVELOPMENT_QUERIES 有录制哈希，不改其文本。负责人 identity 是平台稳定 node ID，login 只供展示，作者由连接认证身份决定。原生 Issue-link 发现属于独立能力，本叶子不依赖 PR #565，也不复制 sourceIssue 关系。

## Design / Spec

选择“给当前 create 操作已确认的唯一 PR 添加负责人”的完整纵向闭环。拒绝 provider-only 半成品、任意 PR URL 输入、从 Issue/reference relation 猜执行 PR、默认指派作者以及通用 metadata 编辑引擎。只有 currentTarget=true、state=saved、confirmedRef 存在且通过现有原操作验证的目标可用。只支持添加，最多选择 10 个；空选表示“不更改负责人”，零外部 mutation。不会移除别人并发加入的负责人。

Provider 增加三种可选方法：仓库候选分页、精确 PR 负责人完整读取、添加所选 IDs。分别声明目录读、负责人读、负责人添加三个 capability；能力缺失先答 not_supported，实际拒绝答 permission_denied。专用 GraphQL 查询仅取所需 id/login、PR id/repository identity。添加前必须验证 PR 属于配置仓库、所选 ID 来自该仓库 assignable users；候选翻页循环、无结束、异常节点、空 ID 均失败关闭。候选列表可按已读取 login 本地筛选并“加载更多”，不声称已搜索全部平台。读取/写入上限和游标限定在同一 binding/repository/limit，换 scope 从首个游标开始。

Core 用一个新的 typed `addChangeRequestAssignees` externalIntent 复用 mutation_attempt JSON，不新增表。冻结原 createOperationId、当前 context/generation/worktree、binding、repository、精确 confirmedRef、actor、排序去重后的 assigneeIds 进入指纹；储存不含 login、URL 或凭据。在一个短事务内验证原操作、查幂等键和相同 PR 未决槽、写 pending，只有成功认领的调用可进行一次 mutation。相同 key 换 IDs 冲突；相同 PR 的其它 key 遇到 pending/unknown 返回原未决操作而不再 dispatch。外部 I/O 不占数据库事务。assignment intent 另带同一 PR 目标下的正 safe integer `sequence`，在原认领事务按 max+1 分配；溢出拒绝新认领。它只表示持久收据顺序，不进入用户请求指纹；同键重放仍复用原操作。无 operationId 的重开发现优先原未决槽，否则选择最大 sequence 终态，不按 hash ID 猜时间。

mutation ack 不作为 Saved 依据。随后完整读取同一 PR 的负责人，只有原生 PR/repository 身份一致且包含所有所选 IDs 才结算 saved；额外 IDs 保留。读回不全、部分成功、ack 丢失或 transport 异常都保持 unknown，不自动补写。明确 mutation 拒绝可结算 failed；用户修授权后可创建新的 assignment 操作。resume 对 pending/unknown 只读同一 PR，绝不调用 add 或 create；query 只读本地记录（Superseded by Decision Log「final fixwave 当前权限反馈」；2026-11-07）。终态读数明确是最后确认，不假装永不改变的 GitHub 当前状态。

每次异步结算与返回身份前，在短事务内重新验证原 create receipt、当前目标、binding/授权以及 assignment 全记录 receipt；旧调用不能覆盖新记录或在撤权后回显人员。PR 创建 saved 与 assignment 状态正交。UI 用 label/原生 checkbox、可选本地筛选及加载更多；saved/currentTarget 下展示“负责人”区、“添加负责人”和未知时“核对原 PR 分配”。断连禁写，scope/accessToken/creator 变化立即清空候选与所选展示，迟到响应失效。默认不读取 email/name/avatar，不提供作者编辑。

## Global Constraints

唯一文件集如下；新增文件已明确标注，执行中扩集须先更新本节并核算预算。产品：`packages/capabilities/src/development-provider.ts`、`packages/capabilities/src/capability-keys.ts`、`packages/capabilities/src/storage.ts`；`packages/providers/development-github/src/assignees.ts`（新，封装专用查询/解码/调用）、`packages/providers/development-github/src/provider.ts`；`packages/providers/fake/src/development.ts`；`packages/core/src/change-request-assignees.ts`（新）、`packages/core/src/create-change-request.ts`（仅内部已确认目标解析导出）、`packages/core/src/context.ts`、`packages/core/src/queries.ts`、`packages/core/src/index.ts`；`packages/controller/src/commands.ts`、`packages/controller/src/queries.ts`；`packages/client/src/change-request-assignees.ts`（新）、`packages/client/src/create-change-request.ts`、`packages/client/src/index.ts`；`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`；`packages/ui/src/change-request-assignees-section.ts`（新）、`packages/ui/src/create-change-request-section.ts`。测试：`tests/contract/development-github-assignees.test.js`（新）、`tests/integration/change-request-assignees.test.js`（新）、`tests/contract/ui-change-request-assignees.test.js`（新）、`tests/contract/storage-contract.test.js`、`tests/contract/harness-host-operations.test.js`、`tests/fixtures/execution-drawer-browser.mjs`、`tests/browser/workspace-execution.test.js`。必要机械接线扩集：`packages/capabilities/src/registry.ts`、`packages/core/src/registry.ts`（Provider 成员闭集）、`packages/core/src/runtime-access.ts`（复用当前 operation 权限代际围栏）、`packages/storage/sqlite/migrations/003_control_facts.sql`（当前 DDL 白名单）；`tests/fixtures/composed-execution-platform.mjs`（真实浏览器场景的合成平台 owner）、`tests/fixtures/change-request-world.mjs`（仅测试 afterRead 次序钩子）；`tests/contract/capabilities-keys.test.js`、`tests/contract/development-github-contract.test.js`、`tests/contract/development-github-create.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/e2e/repository-routing.test.js`、`tests/integration/harness-plugin-host-github-catalog.test.js`（新能力与 ABI 的现有金样）。文档只有本计划和由整合者串行维护的 `docs/README.md`。

预算按 additions+deletions 计：Provider/契约 150、Core/Storage 170、carrier/client 100、UI 95、测试/fixture 230，目标 745、硬门 <800 code/test/config；文档目标 230、硬门 <1300。先用测试草图核算 changed lines；不能以删除恢复/权限测试或交付无 UI 接口压线。实现一个 owner；独立验收者只审查和提出有根因的修订。Node>=22、pnpm 10.28.2，不加依赖，不迁移用户库、不实现旧版本自动升级，不碰 PR #552 的 audit/installed 文件，不改 Planning Status/blocking，不自行合并。

## Plan of Work

### Task 1 · 一个 owner 纵向实现并证明用户闭环

最小闭环是已确认 PR 的原生选择→耐久添加→精确读回→重开恢复。主文件是新 `packages/core/src/change-request-assignees.ts` 和 `packages/ui/src/change-request-assignees-section.ts`，按 Global Constraints 完成所有 carrier 接线。

先写下文具名判别测试并运行，确认缺方法/缺 UI 的预期 RED，而非 fixture 失败。专用 Provider 子模块复用现有 classify/transport，不动原查询哈希；新增能力快照与 Fake 可选实现。提供内部 resolveConfirmedChangeRequestTarget，复用 create 的既有 validator，不复制 create 指纹解析。实现 typed assignment intent 的白名单、事务认领、单次 dispatch、只读恢复与全 receipt 围栏；持久 JSON 不改变 SQL schema（Superseded by Decision Log「当前未发布 DDL 的 operation 白名单」；2026-11-07）。将 Core/controller/Host/client 同一契约串通，再实现可复用 `ChangeRequestAssigneePicker` 与事后 section。原创建区只在 Host 确认的原操作下面挂它，重新加载 saved 操作也可使用。

在检出 `feature/pr-assignee-management` 的工作树根运行：

    pnpm test:file tests/contract/development-github-assignees.test.js tests/integration/change-request-assignees.test.js tests/contract/ui-change-request-assignees.test.js tests/integration/change-request-operation.test.js tests/contract/storage-contract.test.js tests/contract/harness-host-operations.test.js
    pnpm test:file tests/browser/workspace-execution.test.js
    pnpm run typecheck
    pnpm run boundaries

期望新测试先 RED 后 GREEN；最终 tests>0 且 fail/cancelled/skipped=0。浏览器 fixture 使用真实 Host/client carrier 和 SQLite、合成平台 ledger，禁止真实 GitHub 写入或模型任务。回滚单位是完整本 PR，保留外部 PR、负责人和原数据库。

### Task 2 · 独立 spec、产品与质量验收

独立验收者从保存后的本计划、当前 diff 与测试输出重读，不替 Task 1 先写实现。核对每条验收、作者/负责人分离、接口严格解码、未决 key、撤权晚到和空选；浏览器键盘进入候选、添加、核对，并确认当前 PR 创建事实持续可见。临时去掉精确 readback 和 receipt 比较，各须被相应具名测试杀死；还原后重跑受影响套件。

先按风险执行 `pnpm verify`（本叶子涉及身份、外部写入和持久化），然后在该工作树根运行：

    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望退出码全部 0，人工复核五类发布面和严格预算。提交采用 `<type>(<scope>): <中文摘要>`，尾部 Closes #567 / Refs #557。最后整理 commits/push，使用带 `--repo SingularityKChen/harness-projects` 的 `gh pr view`/`gh pr checks` 回读当前 head、base、issue、所有 checks 和完整 reviewThreads 后才 ready；不 merge。验收失败按根因修订再重跑，不能只降级文案。回滚仍为整 PR；B 依赖建立后先撤 B。

## Validation and Acceptance

| 行为 | 判定证据 |
|---|---|
| 原生候选、能力与身份 | `assignee candidates preserve paging scope and distinguish unsupported from denied`；`foreign repository or PR identity causes zero assignment mutations` |
| 先耐久后 dispatch | `assignment intent commits before mutation and concurrent owners dispatch once`，Fake 与 SQLite 两实例；PR create=0、add=1 |
| ack 丢失恢复 | `lost assignment ack reopens SQLite and only reads original PR`，重开后 add 仍1，所有 IDs 读回才 saved |
| 诚实结果与并发 | `partial readback remains unknown and concurrent extra assignees survive`；`same key with changed assignees conflicts`；`empty selection sends no mutation` |
| 撤权与迟到 | `revoked or replaced target cannot settle or reveal late assignee identities`，候选/receipt canary 均不出现在 DOM |
| 可用完整 UI | `confirmed PR can select add and reconcile assignees through production carrier`，真实浏览器 Tab/Space/按钮、重载读回；create 次数不增加 |
| 不扩关系与规划语义 | 保存前后 relations、planning item/Status 全快照相等，空选及负责人未知均不改变原 Issue-link 发现 |

## Progress

- [x] (2026-11-07 SGT) 三份独立设计与真实源码比对，修订为事后添加的完整 UI 叶子。
- [x] (2026-11-07 SGT) Task 1：历史实施源 `a140f57b` 的纵向实现、判别红绿和浏览器组合验证。在检出 `feature/pr-assignee-management`、接合 `origin/main` 后的工作树根运行本计划窄命令并加入 Issue-link/migration 回归，262 tests 全通过；浏览器命令 5 tests、`pnpm verify` 的 3740 tests + 8 MVP0 全通过，均 fail/cancelled/skipped=0；typecheck、boundaries 9 项与 workflow 检查通过。
- [x] (2026-11-07 SGT) fixround1：正式 Provider 测试先 9 tests/2 fail RED，修复后受影响 Provider/恢复/API/client 套件 118/118、浏览器 5/5、boundaries 9/9、typecheck 通过，均 fail/cancelled/skipped=0；未重新运行全量 verify，旧全量证据只归属原 head。
- [x] (2026-11-07 SGT) final fixwave F3：原正式测试使用真实 adapter/Fake Storage，先 18 tests/4 fail RED（当时误称 SQLite；Superseded by 本轮共同出口 SQLite 回证，原 Fake 结果保留）；动态准入及末门修复后，受影响权限/恢复/Provider/API/client/Start Work 套件 194/194，浏览器 5/5、typecheck 和 boundaries 9/9 全通过，fail/cancelled/skipped=0。旧 Saved 保留、query transport 计数不增加、raw deny→regrant 的旧成功被围栏；可选 descriptor 字段不持久化。
- [x] (2026-11-07 SGT) F3 共同出口：显式 SQLite/生产 adapter 的并发已 Saved 快捷回路与已知 native read403 两项先 RED；原 fixture 消费者/权限/恢复/Provider/API/Start Work 扩展回归256项、最终受影响29项、浏览器5项、边界9项与typecheck通过（fail/cancelled/skipped=0）；所有事务结果汇聚后通过末门，真实 failed 保留为 failed 且修授权后新意图可成功。原四项 F3 也已改为显式 SQLite 重跑，旧 Fake 结果不升级为 SQLite。
- [x] (2026-11-07 SGT) Task 2：F1/F2及F3共同出口已独立复审，最终源 `4db6e3ca` / base `7bab4b8c` 零未决P0–P3；7/7归因变异KILLED并逐项恢复。该源码head托管CI/Browser/CodeQL/Fast Gate和全部相关checks、双向567/全线程门通过，Ready回读成立；后续文档head重新核对。

## Surprises & Discoveries

2026-11-07 SGT / F3 共同出口：独立复评证明 Saved 竞争者快捷 reconciled 绕过末门，另 native 预检 read403 的已知失败被动态读取门回滚成 pending。正式显式 SQLite 用例先 20 tests/2 fail RED，分别为错误 reconciled 与 conflict 而非 failed；修订归并 full receipt 合法转移和单一事务结果出口，非权威 failed 不要求继续读人员，但仍观察当前 descriptor。测试脚手架用同一 world owner 保持 reopen/afterRead 引用，真实 read/add403 拒绝与修复凭据的新 Provider 实例重试均具名覆盖。

2026-11-07 SGT / final fixwave：独立全分支审查 F3 的真实 Core/SQLite/生产 adapter 合成 transport 路径证实，已 Saved 后 raw403，显式/latest query 仍返回人员 IDs；真实成功 readback 后另一 raw403 仍可 Saved。新增正式测试当时采用默认 Fake Storage，得到 18 tests/4 fail RED（原 SQLite 口径 Superseded by 本轮显式 SQLite 重跑），另含 raw403→regrant 的 readback 与候选 ABA；修复把本地 descriptor 的当前拒绝和单调世代接入既有 runtime 围栏，query 的 transport 计数保持不变且旧 Saved 证据保留。

2026-11-07 SGT / fixround1：独立评审复现两个 P1。hasNextPage=true 且缺 endCursor 时，目录/精确读回/添加原先都返回成功且发送一次 mutation；重叠拒绝 A/B→C/D 的旧拒绝原先将 epoch 从2降回1，允许 C 的旧身份返回。正式 Provider 测试先复现这两个 RED；共享 page decoder 现在只允许明确 false 结束、true 必须有前进的非空游标，拒绝 epoch 从 live 值递增。null/空/重复游标与原单拒绝晚到用例保留。

2026-11-07 SGT / 实施取证：SQLite `003_control_facts.sql` 的 CHECK 只接纳 startWork/createChangeRequest，新 assignment intent 在持久认领时被拒绝；必须扩当前 operation 白名单。Provider 的两个 registry 成员闭集与既有能力/remote 金样也必须同步。真实浏览器 seed 的合成 GitHub transport 位于 Global Constraints 新增的 fixture owner，原五段查询文本保持原样。首轮全量验证在旧 base 的 3694 项中出现 7 个新成员金样不符；同步后对应 144 项窄回归通过，接合 main 后最终全量结果记录于 Progress。输入冻结、Host getter、终态序号与序号溢出重放又分别先 RED 后 GREEN；改动保持请求身份与系统分配顺序正交。

原设计 C 的 provider-only A 不符合每 PR 用户闭环，已在 Design / Spec 改为带实际选择 UI 的 A。create 操作 query 不返回 confirmedRef 给客户端；目标必须由 Core 解析原 createOperationId，不能由 UI 拼 PR 身份。现有 Core query 是纯本地读取，候选与外部读回置于显式 commands，避免偷偷让 query 做 Provider I/O（原 static gate 足以反映授权的假设 Superseded by Decision Log「final fixwave 当前权限反馈」；2026-11-07）。原请求已支持 typed JSON intent，因此无需新表或兼容框架。

## Decision Log

2026-11-07 SGT / 主任务批准同一 F3 共同出口与真实 DRY：不在快捷分支另补一个门，所有成功结果统一经过最后门；明确拒绝沿本地完整 receipt 校验写 failed，不能因人员拒读永久占未决槽。仅测试 fixture 增 afterRead；Provider 两个消费者复用同一完整 scan，保留100页、终页、循环/跨页重复ID和每页原生身份证明。保留全部安全 case；移除两个由真实调用/registry覆盖的 typeof 哨兵，复用测试 defer response/setup 与 ProjectError 已有 re-export，避免为预算删空行或挤代码。

2026-11-07 SGT / 主任务批准「final fixwave 当前权限反馈」：组合时 binding capability 不再作为 assignment 当前授权证明。复用 runtime-access 的 operation/observeOperation/operationVersion；Core 在准入、本地身份返回和最后结算事务读取当前懒式 descriptor，原生 query 不发 GraphQL。ProviderCapabilitySnapshot 可选 permissionVersion 是 Provider 本实例已观察拒绝的按 capability 单调 safe integer 映射；GitHub 复制既有内存 epochs，不暴露可变引用。runtime 校验绑定/字段形状并拒绝代际回退，将变化镜像到既有 operation version，旧成功不能穿越 raw403→regrant；三能力独立，旧 Saved 行保留。Rationale：静态门挡不住组合后拒读，且仅捕获 Core error 看不到 raw native 并发拒绝或 ABA；这不是新权限权威、持久 schema 或通用 metadata 引擎。

2026-11-07 SGT / fixround1：仅修复独立评审 F1/F2，不变更 Core/Host/UI 职责、持久格式或候选缓存。Rationale：两个失败分别归因于共享分页 decoder 的 undefined 旁路和 async 捕获 epoch 写回；在源处修复即可同时约束 list/read/add 及共享权限状态。`pnpm test:file tests/contract/development-github-assignees.test.js` 的新增判别覆盖两类次序/形状，不以之前完整绿套件替代新 head 复审。

2026-11-07 SGT / 主任务批准「当前未发布 DDL 的 operation 白名单」：既有 typed JSON 复用不等于 SQL CHECK 允许新值，直接扩当前 003 DDL 的精确 command/operation 配对；不新增表、自动迁移或旧版兼容。旧 schema 继续 fail closed，保留原库，运行 artifact 与相应 DB 配对。Rationale：源码推翻了无需改 DDL 的假设；产品尚无正式发布。

2026-11-07 SGT / 主任务批准 per-PR sequence：SQLite `listMutationAttempts` 明确按 id 排序，failed→新 key saved 与多次 saved 的重开测试推翻了无顺序元数据即可发现最新终态的假设。sequence 进入当前 typed intent/DDL 白名单，正整数上限为 Number.MAX_SAFE_INTEGER；请求指纹排除它，同键重放不重新认领。Rationale：恢复最新真实结果，并保持新增顺序与用户请求身份正交。

2026-11-07 SGT / 主任务批准必要机械接线扩集，范围见 Global Constraints；实施后接合最新 main 的来源 Issue 与权限恢复语义，再运行最终窄回归和全量验证。独立验收保持 Task 2 未完成。

2026-11-07 SGT / 独立综审：采用主任务已批准的 A→B 切片，A 关联叶子与 Refs #557，B 承担创建前意图并最终 Closes #557。Rationale：A 可独立使用、合并和回滚；不以父项过早关闭替代 B。

2026-11-07 SGT / 独立综审：unknown 只读恢复，空选不写，add 采用子集确认。Rationale：避免重复外部副作用和删除人类并发新增；未发布代码只维护当前契约。通用 metadata、移除/替换/批量编辑均是明确不纳入本能力的产品范围，无故意遗留的实现捷径；若实施产生可靠性缺口，先记 `docs/exec-plan/tech-debt-tracker.md` 再重新准入。

## Idempotence and Recovery

查询和测试可重复。候选 cursor 不跨 scope 重用。失败事务不允许 dispatch；持久 pending 的崩溃只恢复原 intent、只读原 PR，未知不得换 key 绕未决槽。已有 saved PR 不因负责人失败降级。明确 failed 可在修授权后由用户新 assignment 操作重试；pending/unknown 先完成原操作核对。不可恢复历史或损坏意图 fail closed，保留原库，不猜 ref、不删记录。

代码回滚不撤销 GitHub 负责人，也不擦持久证据；如要运行旧二进制，先用新增 intent fixture 验证旧读端拒绝未知形状，使用回滚前已验证的独立备份/隔离库，不能把未知字段当无人成功。不存在生产发布兼容承诺，不为未发布 schema 添加双版本状态机。

## Interfaces and Dependencies

`ProviderCapabilitySnapshot.permissionVersion?: Readonly<Partial<Record<CapabilityKey, number>>>` 只携带本 Provider 实例内按 key 的单调非负 safe integer 拒绝代际。映射复制出站；Core current descriptor gate 拒绝未知 key、存取器、非法数字、错误 binding 和代际回退，不把 observedAt 当版本，不持久化该映射。未提供此字段的实现继续通过既有 Core observeOperation 反馈其已观察结果；生产 GitHub assignee 的原生并发拒绝由此字段围栏。

Provider 当前单一契约（三个方法均 optional，均返回 ProviderResult）：`listAssignableUsers({repository: ExternalObjectRef,cursor: string|undefined,limit: number}): Promise<ProviderResult<ProviderPage<{id:string,login:string}>>>`；`getChangeRequestAssignees({repository:ExternalObjectRef,changeRequest:ExternalObjectRef}): Promise<ProviderResult<{changeRequest:ExternalObjectRef,users:readonly {id:string,login:string}[]}>>`（方法内完整分页）；`addChangeRequestAssignees({repository:ExternalObjectRef,changeRequest:ExternalObjectRef,assigneeIds:readonly string[]}): Promise<ProviderResult<void>>`。keys 固定 `development.assignee.list`、`development.change_request.assignee.read`、`development.change_request.assignee.add`，三个权限证据独立；查询/添加权限不得借 create 的 available。

Core 定义 `AssigneeScope={workItemId:string,repositoryId:string,createOperationId:string}`。目录 scope 固定为 `AssigneeRepositoryScope={workItemId:string,repositoryId:string}`，仅要求当前合法工作项/仓库/执行上下文和对应目录读权限，不要求 PR 已创建，以供下一叶子复用。commands 为 `listChangeRequestAssigneeOptions(AssigneeRepositoryScope & {cursor?:string,limit:number,observer:Actor})`、`addChangeRequestAssignees(scope & {assigneeIds:readonly string[],actor:Actor,idempotencyKey:string})`、`resumeChangeRequestAssignees(scope & {operationId:string,observer:Actor})`；query 为 `getChangeRequestAssigneeOperation(scope & {operationId?:string})`。candidate options 返回同一 repository scope、targetStamp、items、nextCursor，响应前复核目标/授权；本地 query 返回 none/blocked/operation，operation 带 operationId、targetStamp、state、canonical requestedIds 与最后确认的 confirmedIds（不存 login）；blocked 不携带旧身份。写结果沿现有 phase→CommandWriteState 映射，不以 ack 生成 authoritative。

controller 加 envelope、严格字段白名单；Host OPERATIONS 加同名 unary handler 与准确参数，拒绝未知/存取器字段，Host 结果带 workspace/workItem/repository/createOperationId。client 新 `ChangeRequestAssignees` 有 `options(scope,cursor?)`、`operation(scope,operationId?)`、`add(scope,ids)`、`resume(scope,operationId)`；它只持在途 single-flight，不持久保存身份。`ChangeRequestCreator` 增加可选只读 `assignees?: ChangeRequestAssignees`，Host 构造时注入，避免跨所有 UI 壳加一条 prop 链；未提供表示 unsupported。picker 接收 AssigneeRepositoryScope、该 port、connected、value IDs、onChange；事后 add 另带当前已确认 createOperationId。标签仅来自当前获准候选页，恢复只剩 ID 时显示“身份暂不可读取”；不把历史 login 持久存储。B 直接复用同一个候选控件。

依赖现有 GraphQL transport、mutation_attempt JSON、Host envelope 与当前 create confirmation。实现前只读 schema 验证：`gh api graphql -f 'query=query { a:__type(name:"AddAssigneesToAssignableInput") { inputFields { name } } b:__type(name:"CreatePullRequestInput") { inputFields { name } } }'`，期望前者含 assignableId/assigneeIds、后者不含 assigneeIds；只读不做真实平台 mutation。

## Outcomes & Retrospective

原设计阶段交付的是可执行设计（Superseded by Progress 的 Task 1 实施证据；2026-11-07），不是产品完成或测试通过。已形成原生 Provider→Core→Host/client→UI 的合成平台实施证据，SQLite 重开只读恢复保持 create=1/add=1，部分读回不补写、关系/规划快照不变，详见 Progress；独立验收、实际平台 token 能力以及安装人类接受尚未发生；自动化合成证据不得升级为真实平台/发布接受。完成后更新本节、Progress 并按 PLANS 归档；工程 ready 不推进 Planning Status。

2026-11-07 SGT最终工程结果：前段“独立验收尚未发生”Superseded by本段。受验源码 `4db6e3ca` / base `7bab4b8c` 独立最终审查无未决P0–P3。七项变异的baseline→具名业务失败→还原均0→1→0；恢复29/29、carrier/runner38/38、另一Core先query的真实SQLite ABA1/1、新main受影响39/39和typecheck通过。各组重叠不累加；256/29/5/9及旧3740+8保留各自源身份。该源码head当前托管门、双向567关联和全部线程回读通过后已置Ready，未merge。工程评审见 `docs/review/pr-568-mmp-review.md`；文档归档提交后必须重查最终head。原库/匹配artifact、真实平台、安装、人类UAT及R1仍另计；未引入有意延后的实现捷径，无新技术债条目。

## Bottom Change Note

2026-11-07 SGT：F3 共同出口补齐并纠正原 Fake/SQLite 证据口径；明确拒绝仍 failed，Provider 完整分页真正去重，测试 fixture hook 不进入生产；保持 Task 2 复审门。

2026-11-07 SGT：记录独立最终全分支 F3 与 static gate 假设的原处 Superseded；批准最小可选 permissionVersion 描述及现有 runtime operation 围栏接线，保留原 Saved 与 Task 2 复审门。

2026-11-07 SGT：记录 fixround1 的两个独立 P1 及最小修复；Task 2 仍待复审，修订验证只跑受影响 Provider/恢复/API/浏览器/类型与边界，不重复无新增风险的全量验证。

2026-11-07 SGT：记录 Task 1 最终窄回归、浏览器、全量验证与边界检查；Task 2 独立验收保持未完成，未执行 push/ready/merge。

2026-11-07 SGT：接合最新 main 的来源 Issue/权限恢复；补充事务 sequence、重开终态排序、幂等身份排除顺序与 safe integer 溢出拒绝。

2026-11-07 SGT：增加必要 registry、DDL、合成平台 owner 和金样接线，记录原 SQL 假设被源码推翻及其最小修正；保留 Task 2 独立验收门。

2026-11-07 SGT：综合三份独立方案并按真实模块修订；拒绝 backend-only 叶子，冻结只添加/只读恢复、当前 createOperationId 目标、显式外部读取命令与最小 UI carrier 契约。

2026-11-07 SGT：归档最终独立矩阵、七项判别变异和源码head Ready观察；明确新主线已退役独立Merge Gate，最终文档head以现存CI/Fast Gate实际回读为准。
