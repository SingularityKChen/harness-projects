# 创建 PR 前预选并恢复原负责人意图 ExecPlan

> 状态：Active；创建：2026-11-07；关联：Closes #557。本计划遵循根 `PLANS.md`。基底以 Task 1 的开工回读为准：A 最终 head/base、当前 main 与绑定该 head 的独立验收均须核实；A 的 common-exit/failed-retry 修订仍在收尾，不能据本计划推断已 clean（此开工前描述 Superseded by Progress 的 A 最终验收与 Task 1 开工记录，2026-11-07）。本文件先是运行态审阅结果，由整合者保存到 B 检出的 `docs/exec-plan/active/2026-11-07-pr-assignee-creation.md`，不另建协调 issue。

## Purpose / Big Picture

用户在创建 PR 表单显式预选仓库允许的负责人或保持不指定；创建确认后把原生 IDs 添加到同一个 PR，分别看到“PR 已确认”“来源 Issue 关联状态”“创建时负责人状态”。网络中断、重载、创建或分配 ack 丢失均保留原元数据，恢复原 PR，不再次创建，也不重复发送同一个 assignment；作者、规划负责人和 Planning Status 不由此改变。

最小证据是生产 Host/client/UI 与 SQLite 重建完成一次选择、一次 create、至多一次 add；默认不指定时 add=0。Draft、来源 Issue 的 reference/closing/none 以及其权限恢复行为都保持现行合同。

## Context and Orientation

A 的实现计划是 `docs/exec-plan/completed/2026-11-07-pr-assignee-management.md`，关联叶子 #567；A 已实现，独立验收是否 clean 必须在 B 开工前回读。2026-11-07 SGT 首次接口观察为 `a140f57b`，该固定基底 Superseded by Task 1 的最终 head/base 回读规则；当前实装接口仍为：`packages/core/src/change-request-assignees.ts` 持有唯一 assignment 协议，`packages/client/src/change-request-assignees.ts` 提供 port，`packages/ui/src/change-request-assignees-section.ts` 提供已存在的 picker/事后添加区。其余外部能力由 A 已接线，B 不重新实现 Provider。

原本“研究基线45330b54、A接口尚待实现”的依据 Superseded by 本节当前 `a140f57b` 实际接口（2026-11-07）。当前创建链已包含主线 #565 的 sourceIssue 关系：`ChangeRequestExternalIntent.issueSelection`、请求的 issueRelation/issueTargetStamp、正文托管 Refs/Closes 段、relationState，以及 `packages/core/src/change-request-issue-link.ts` 的准入/核对。`DeliveryLineageSection.creatorAccessToken` 传入创建区 accessToken，与谱系自己的 accessToken 分开；创建区 metadata 更新只重查 Host，保留用户草稿和写入消费者身份。

A 实际扩充了 `packages/storage/sqlite/migrations/003_control_facts.sql` 的当前 CHECK，接纳 command/operation 配对和 assignment 正 safe integer sequence。这是主任务明确裁定的未发布 DDL 修改，不是自动迁移。旧 schema 继续拒绝新 assignment；原库保留，运行 artifact 与对应 DB 配对。B 继承此事实，不重做迁移项目，也不恢复旧用户库。

## Design / Spec

采用“创建前冻结意图，确认原 PR 后复用 A”的第二个完整叶子。默认“不指定负责人”；缺少 assignees port 时明确当前连接不支持，仍允许默认无人创建。拒绝 UI fire-and-forget、随机 key 编排第二阶段、按最新无 operationId 的 assignment 代替原创建意图、把赋值失败当创建失败，以及重新实现 Provider/序号协议。

创建 Core request/client intent 增加可选 `assigneeIds:readonly string[]`，要求数组、最多10个、每项 trim 后非空但保留原 ID 字节；读取调用方字段与数组一次，立即复制、去重、排序，第一次 await 前冻结。省略与[]规范成同一不指定意图。非空 IDs 只以 `requestedAssigneeIds` 保存在 create externalIntent 根，并进入现行 canonical；空选不新增该属性，保持现行包含 issueSelection/draft 的 canonical。clone、字段白名单和严格解码同步增加字段；ProviderCreateChangeRequestInput 完全不变。

非空请求在 create dispatch 前，用本次创建已选择的同一 binding/repository route 独立预检 DevelopmentAssigneeList、DevelopmentChangeRequestAssigneeRead、DevelopmentChangeRequestAssigneeAdd 的 gate 和可选方法。明确不支持/拒绝时不创建 PR，给安全的负责人原因、允许清空选择重试；无人路径不要求这些新能力。目录与create若解析到不同binding，创建前拒绝非空选择，不借另一连接的能力放行。A 的 options/picker 仍负责合法原生候选，真正 assignable 和 PR/repo 身份校验复用 A Provider。权限可能在创建后改变，必须保留“PR已确认、负责人失败/未知”的独立结果。

完整保留 sourceIssue 选择、预览 target stamp、verifyChangeRequestIssue、issueClause、托管 marker、relationState 和 draft 类型/默认值。新增 IDs 不替换 issueSelection，不跳过来源验证，也不因负责人为空/失败改变 closing-link 发现。mutable assignees 永不进入 identityCandidate/provesCreation；创建恢复仍沿原 marker/confirmedRef 和原 draft 证据。提交后的 form 不得重新构造原 IDs/Issue 选择。

Core 从已耐久且 saved/currentTarget 的原 create 取原 actor 与 IDs，稳定 key 定义为 `pr-assignees:` + createOperationId + `:` + sha256(JSON.stringify(canonical IDs))。此 key 只用于 Core 调 A 的 add；绝不调用 client.assignees.add 来编排，它内部为显式人工添加生成随机 UUID。B 使用 `storage.findMutationAttempt(workspaceId,key)` 查确定的原 assignment；已有记录严格验证 command/目标/请求后，调用 A resume 指定 operationId。没有记录时才调 A add 认领一次原冻结的第二阶段。A 保持事务序号 max+1、同key稳定、overflow拒绝和全 receipt 围栏；B不自分配sequence、不用它作用户请求fingerprint。稳定记录已明确failed时，B直接读回该终态，不再尝试认领或自动换key；pending/unknown才沿原operationId只读恢复。

必须区分 B 稳定记录与 A 的人工事后添加。A 无operationId查询用于 latest-terminal discovery，不能代表 B；若 A add 遇到其它未决槽返回别的操作，B重读稳定key未找到时只报未确认/槽位占用，不采用其它 requestedIds 的成功。原槽处理完成后，下次原创建恢复可认领尚不存在的 B 稳定记录。稳定记录存在后，pending/unknown只resume该operationId，saved/failed/conflict仅派生原记录终态；后续人工添加更大sequence不替换创建时意图结论。创建未确认时 add=0；assignment pending已耐久但dispatch前崩溃时保守unknown，不猜未执行补发。

B继承A的runtimeAccess操作权限版本与公共最终出口：普通结算、并发saved、pending→unknown重读、空选和失败路径不能绕过当前目标/receipt/权限裁定；明确failed可保留安全失败结论，不回显受限IDs或人员。Provider capability快照可选的 `permissionVersion` 是易失deny/regrant世代，既不进入create/assignment持久intent、fingerprint或DDL，也不作为用户请求字段；B不自行造第二个epoch/授权缓存。

仅初始 requested IDs 写入 create intent；assignment进度/sequence/operation链接不回写 create record，避免改变 A 已冻结的 createReceipt。结果和本地 create query 按稳定key派生独立 assignment摘要，query 仍只读本地，不启动第二阶段。任何 assignment异常不得丢掉已确认的create ref/entityId/phase与原relationState。最后一个赋值 await 后重新核验当前create receipt/target/授权，再返回安全摘要；Host finishChangeRequest最后读仍裁决currentTarget。旧响应不能把新收据或撤权遮蔽覆盖成成功。

UI直接复用 ChangeRequestAssigneePicker，在现有来源Issue控件之后、draft之前；value是本地可编辑 IDs，port是creator.assignees，默认[]。明确“不指定负责人”可清空选择。picker当前没有accessToken参数，父组件用scope+accessToken作它的React key：token变化立即清旧候选/编辑中IDs并重查，但保留base/title/body/draft/issueRelation和现有current.pending；不能给整个创建区换key或reset owner来丢草稿/重复写。本条仅要求同一工作项内权限 token 变化保留草稿；更换 workItem/repository 或 creator 沿既有 owner reset。提交后只显示Host原requestedIDs与独立状态，picker的onChange([])不得改已持久请求。已确认区继续保留A的事后添加入口；“创建时负责人”摘要与后来人工添加分开。

明确failed后显示“PR已确认，创建时负责人添加失败”，修复权限后用户可在A已存在的事后添加区重新确认IDs并显式“添加负责人”，形成新key/新intent；原创建稳定记录仍保持failed并只读，不能把新显式intent冒充原记录重发，也不能让重载或“读回原操作”无限循环dispatch。该新动作不是再次创建PR，不新增B retry API、重试序号或自动补写。

PR状态、Issue关联与负责人分三段反馈；负责人unknown仅“核对原PR分配”，走原create resume编排，不出现第二创建按钮。标签只来自当前授权候选，不持久存login，恢复仅有IDs则显示“原负责人意图已保存，身份暂不可读取”。断连禁写；scope、creator、creatorAccessToken变化后迟到候选/结果不回显。沿现有原生label/checkbox和dialog焦点规则，不加作者下拉、头像或嵌套弹窗。

## Global Constraints

唯一文件集：`packages/capabilities/src/storage.ts`；`packages/core/src/create-change-request.ts`、`packages/core/src/change-request-assignees.ts`（仅创建第二阶段的内部编排复用，不改A协议/序号）；`packages/controller/src/commands.ts`；`packages/client/src/create-change-request.ts`；`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`；`packages/ui/src/create-change-request-section.ts`、`packages/ui/src/delivery-lineage-section.ts`、`packages/ui/src/work-item-detail.ts`；`tests/integration/create-change-request-assignees.test.js`（新）、`tests/integration/change-request-operation.test.js`、`tests/integration/harness-plugin-change-request-operation.test.js`、`tests/contract/ui-create-change-request.test.js`、`tests/contract/storage-contract.test.js`、`tests/contract/harness-host-operations.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/fixtures/composed-execution-platform.mjs`、`tests/browser/workspace-execution.test.js`；本计划和整合者串行维护的 `docs/README.md`。A的picker/client-assignee/Provider/003 DDL均复用现行代码；如新证据要求扩集，先改本节再核预算。

预算按净B diff的additions+deletions：根metadata/冻结与Core编排220、controller/Host/client100、UI100、测试与fixture300，目标720、硬门<800 code/test/config；文档目标230、硬门<1300。一个metadata owner按A→B串行；B基于A最终review-clean head，实际PR base计数。Node>=22、pnpm10.28.2，不增依赖、不新表、不新增迁移/版本兼容框架，不抹去A的DDL裁定，不修改#552审计文件、Planning Status/blocking，不自行merge。

## Plan of Work

### Task 1 · 同一 owner 完成实际A之上的纵向闭环

主文件是 `packages/core/src/create-change-request.ts` 与 `packages/ui/src/create-change-request-section.ts`，全部改动按 Global Constraints。开工先在A检出根执行下列只读命令，取得当前PR与提交身份；独立验收记录必须对应同一head，common-exit/known-failed retry回归必须包含在其证据中，不能用较早已测head替代：

    gh pr view feature/pr-assignee-management --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,state,reviewDecision,isDraft,statusCheckRollup
    git rev-parse HEAD origin/main
    git status --short --branch

期望本地head与回读远端head相等、工作树无实现残留、A独立评审无未决阻塞；由整合者补最终reviewThreads分页证据，不能仅凭reviewDecision推定clean。main若更新，先由A owner完成接合和受影响验证，再回读。未clean不实施B；clean后从该head建 `feature/pr-assignee-creation`，未合入时PR base明确指向feature/pr-assignee-management，已合入则main。关联父#557并保存本运行态计划为正式active；不另造协调issue。

先在下文具名用例验证缺metadata行为RED。用A现有Fake/SQLite协议构建独立平台ledger：严格输入复制和根requestedIDs、canonical/marker、Issue三种选择与draft必须一同测试。实现单一 continueCreationAssignees内部编排；可放在A的命令模块并复用公开add/resume，避免复制resolver。必须在创建/恢复的共同成功路径调用它，同时本地query只派生摘要；检查任何早退saved分支也不会漏掉尚未认领的第二阶段。保留A显式add/terminal discovery/common-exit/failed-retry所有回归；复用A公共最终gate，不另写直接返回成功的快捷分支。

扩现有Host create positional ABI，仅在issueTargetStamp后追加assigneeIds；同步param whitelist、controller、client Port及元数据解码、生产fixture，旧参数顺序不改。UI保留来源Issue options/default/手动重验和creatorAccessToken逻辑，直接挂现有picker与三段反馈。最后验证真实Host/client/SQLite浏览器从预选、草稿PR、关系选择、ack丢失到重开核对，不以Provider单测代替入口。

在检出 `feature/pr-assignee-creation` 的工作树根运行：

    pnpm test:file tests/integration/create-change-request-assignees.test.js tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/create-change-request-link-recovery.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/change-request-assignees.test.js tests/contract/ui-create-change-request.test.js tests/contract/storage-contract.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js
    pnpm test:file tests/browser/workspace-execution.test.js
    pnpm run typecheck
    pnpm run boundaries

期望新增测试RED→GREEN，最终tests>0、fail/cancelled/skipped=0。合成平台与当前A schema的隔离SQLite经生产carrier，无真实GitHub mutation/模型任务。回滚完整B保持A事后添加能力，保留外部PR/负责人和原库，不清库。

### Task 2 · 独立验收父AC与已合主线语义

独立验收者重读保存后的计划、A实际接口、B diff及输出，逐条审父#557：可选/无人、原生IDs与读回、原意图重载、创建/assignment分态及Issue-link无关。特别检查A的序号不是B关联键，createReceipt不因进度更新漂移，同key碰撞/其它未决slot不误认confirmed。三种变异分别删去metadata fingerprint、把稳定恢复换成latest发现、去掉已有record只读保护，均须被具名用例杀死，还原后重跑。

浏览器以真实 Tab/Space 证明负责人可达与选择，用 Enter 提交/恢复原创建；来源 Issue 三选项使用原生 select.selectOption 并验证 Tab 可达，不声称由箭头键切换。覆盖 default 无人、预选、draft、来源 Issue 三态、creatorAccessToken更新保留草稿但遮蔽旧候选、断连/撤权晚到、创建成功指派失败仍显示PR。当前主线的 `pnpm verify` 由typecheck及contract/integration/e2e三个非空测试层组成，Browser另跑上述命令；不要求已退役的Merge Gate或MVP0 lane。沿用当前push-only客户端生产carrier，不恢复旧request/polling接收路径。最终执行 `pnpm verify`；并在上述B检出根、A未合入时运行：

    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure feature/pr-assignee-management
    node scripts/rule-checks.mjs size feature/pr-assignee-management
    git diff --check feature/pr-assignee-management...HEAD

若A已合入，将三处基准统一替换实际PR base `origin/main`，记录当次base/head和输出。期望退出0、严格预算及人工五类发布面通过。提交中文、尾部Closes #557；最终push前整理，push后用明确 `--repo SingularityKChen/harness-projects` 的gh读取当前head/base/closingIssuesReferences/checks及全部reviewThreads，当前head证据成立后ready，不merge。安装人类接受如实单列。

## Validation and Acceptance

| 行为 | 判定证据 |
|---|---|
| 正常与无人 | `preselected native IDs freeze before first await and assign only confirmed PR`：create=1/add=1；`unassigned creation preserves current Issue and draft canonical with zero assignment` |
| 来源与草稿 | `assignee metadata preserves reference closing none draft and source permission recovery`；原Issue clause/marker与作者、Planning负责人/Status不变，Issue-link发现照常 |
| 丢创建ack | `lost create ack reopens original IDs and Issue choice before first assignment`：create仍1，原PR确认前add=0 |
| 丢分配ack | `lost assignment ack reopens exact stable operation without redispatch`：create=1/add=1；pending-before-dispatch崩溃也不补发 |
| 序号/人工并发 | `creation assignment follows stable key despite newer manual terminal sequence`；`different unresolved assignment cannot confirm creation requested IDs`；两Core继续/恢复认领一个稳定record |
| 指纹与receipt | `same create key with changed native IDs conflicts`；`assignment progress leaves frozen create receipt unchanged`；调用方改数组和迟到receipt不能篡改意图 |
| 独立失败 | `created PR and Issue relation survive assignment denial partial or unknown`；create失败add=0，非空unsupported/denied预检create=0，空选不要求A能力 |
| failed后显式重试 | `known failed creation assignment never redispatches on resume while a new explicit add can succeed`：多次重载/原resume的add次数不增长，修权限后A新intent成功，原failed收据不改 |
| 公共权限出口 | `creation continuation cannot bypass common final permission gate after concurrent saved denial or regrant`；新增metadata/摘要不持久保存permissionVersion |
| UI/权限 | `preselection and reload use actual picker and production carrier without second create`；`creator access change masks candidates while preserving draft and current write ownership` |

## Progress

- [x] (2026-11-07 SGT) A受验源码4db6e3ca独立最终复审clean、托管/双向567/线程通过后Ready；docs-only上游8f0e2f8a非docs树逐字相同并独立重锁。B已建draft PR581和原生stack582，手工原生关闭连接581↔557双向读回，基线创建Core/UI57/57。尚未开始产品实现。

- [x] (2026-11-07 SGT) 完成原design-a/design-b/product-design三输入综审；原研究接口已由本次实际A对齐取代，不声称新增独立设计轮次。
- [x] (2026-11-07 SGT) 只读A@a140f57b及当前Core/client/UI/DDL，修订本运行态计划并独立重读；这是计划证据，不是B实现或测试通过。
- [x] (2026-11-07 SGT) 同步当前A公共权限出口/明确失败重试与主线push-only/test-runner变化；仅更新运行态计划，A clean与最终rebase head仍待其owner提供并回读。
- [x] (2026-11-07 SGT，检出 `feature/pr-assignee-creation` 的 Task 1 提交内容) 纵向实现与具名 RED→GREEN 完成：metadata、稳定键/原 actor、原收据不变、明确 failed 只读、并发/权限/迟到收据围栏及 UI/Host 联通。最终 `pnpm verify` 退出 0：contract 1400、integration 2070、e2e 226，全部 fail/cancelled/skipped=0；完整浏览器 6/6，typecheck/boundaries/workflow 检查通过。此批次属于 5675ce92 的历史结果；其同项草稿与最新摘要消费结论 Superseded by 下条 Fix round 1 实际生产链验证（2026-11-07）。最终本地 head、分层净 B 统计及披露扫描由 Task 1 报告记录，Task 2 独立验收和远端收尾尚未执行。
- [x] (2026-11-07 SGT，检出 `feature/pr-assignee-creation` 的 Fix round 1 内容) 修正 P2/P3 并补齐 Core 组合与浏览器证据。当前源 `pnpm verify` 退出 0：contract 1404、integration 2072、e2e 226，全部 fail/cancelled/skipped=0；浏览器 11/11、受影响窄回归 95/95、独立 typecheck 与 boundaries 9/9 通过。提交后 exact head/净 B 规模与机械检查存同一 Task 1 报告的 Fix round 1；独立 re-review/危险变异与远端收尾不由本地绿替代。
- [x] (2026-11-07 SGT，检出 `feature/pr-assignee-creation` 的 test-only 证据闭合) Scoped re-review 已将原 P2/P3 判为 ADDRESSED 且 Approved；补其非阻断 P3 时序缺口：精确捕获被 hold 的原 options Request，release 前注册相同 Request 的响应，await finished 与下一浏览器帧后再检查旧候选不回显。具名 1/1、完整浏览器 11/11 通过。生产、contract/integration/e2e 与 fixture 源逐字等于已审阅 548f05f，不重跑旧绿 verify；其三层证据保持归属原源码。
- [ ] Task 2：独立验收、修订、最终预算/披露与远端回读ready。

## Surprises & Discoveries

2026-11-07 SGT / Task 1：首轮完整验证在 contract 层因 typed remote 参数长度快照未同步失败（1398/1399），integration/e2e 未运行；第二轮 contract 全绿，integration 的 2070 个测试唯一失败为既有 bundle primitive 默认无人路径多传尾部 `[]`，e2e 未启动。client 空选择不附加可选尾参数，保持省略与空选 canonical 同义；修复与最终验证以 Progress 的最终记录为准。新增二阶段摘要也须保留 A 公共 gate 拒绝结果，避免重新读取已保存记录将 deny/regrant 围栏洗成成功；末次负责人授权 await 后须再核 create receipt。三者均以具名 RED 建立判别。

原假设“typed JSON无需DDL变化” Superseded by A所属计划Decision Log「当前未发布DDL的operation白名单」（2026-11-07）：A实际扩003 CHECK，主任务已裁定无迁移、旧schema拒绝且保留原件/配对artifact；B不改该裁定。原假设“恢复可取当前assignment” Superseded by Design / Spec稳定key关联：A实际无ID查询按per-PR sequence找最新终态，人工后续操作可比B更新。

A的client.add生成随机UUID，只适合用户显式事后添加；B必须用Core已有AssigneeAdd.idempotencyKey入口。A的createReceipt包含完整create intent；若B把进度存回create，会破坏原assignment恢复。当前main已经有sourceIssue和creatorAccessToken，不能继续以旧45330b54的四字段表单为实现起点。

## Decision Log

2026-11-07 SGT / Fix round 1 父层修订（整合者批准）：创建区 React key 只用 scopeKey，谱系仍用原授权 key，已确认后的 A 负责人区 key 不改。Rationale：真实 native 目录 403 与 Host 来源权限元数据变化时，原父层 key 会重挂创建表单，标题实测被清空；原 component-only 足以证明全链保留的假设 Superseded by 本条生产浏览器 RED。creator/accessToken props 与既有内部 owner/generation 继续裁定新 scope/creator，候选子树独立失效。

2026-11-07 SGT / Fix round 1（整合者批准）：增加 Global Constraints 中两处 UI 透传文件，将现有开始工作结果通知 `executionRefresh` 仅传至 picker 的局部 refreshToken/key；不换创建 owner、草稿或 pending 消费者，不修改 A picker。Rationale：已有结果通知可直接触发安全重读，无需推断另一条 lineage 就绪链。该回调对 failed/unknown 也会触发，因此仅是重读通知，不是 Core 就绪/授权事实；若多读，仍由原目标/权限门拒绝。

2026-11-07 SGT / Task 1 实证范围修订（整合者批准）：Global Constraints 增补 typed remote 的既有契约快照；仅把 create 参数数从 10 同步为 11。Rationale：首轮 `pnpm verify` 的 contract 层 1399 个测试中唯一失败为 `typed remote contribution exposes the same strict descriptors`；遗漏机械 ABI 消费者不是产品设计变更，扩集后净 B 仍须重算并严格小于 800。

2026-11-07 SGT / 原综审：B使用父#557并最终Closes，A独立叶子Refs父项；A→B必要stack、同owner串行。Rationale：B直接完成原接受标准，不复制assignment算法。

2026-11-07 SGT / 当前接口对齐：继承A已裁定的003当前DDL、sequence和旧schema拒绝/原库保留/产物配对；不声称B是“从未改过schema”的项目。Rationale：真实源码推翻旧假设，B只扩create JSON根白名单，不新增迁移。

2026-11-07 SGT / 当前接口对齐：稳定key精确关联原创建assignment，sequence只归A决定；create intent不写进度，query只本地派生。Rationale：同时保持人工后续操作、原收据与B原意图的正确身份。sourceIssue三态/draft/creatorAccessToken为现行必须保留的合同。

2026-11-07 SGT / 权限与失败同步：B不持久保存permissionVersion、不绕过A公共最终gate；原stable记录的明确failed只读，修权限后新显式添加由A新intent承接。Rationale：失败证据与未知恢复正交，既不无限重发原记录，也不把用户重试永久禁用。main的Host create参数仍终止于issueTargetStamp，B只在其后追加IDs；push-only收帧和分层test runner继续使用当前实现。

2026-11-07 SGT / 原安全取舍继续适用：create saved且无稳定record时可认领第二阶段，有record只read/resume；pending提交后dispatch前崩溃可能保守unknown。Rationale：避免重复外部副作用；自动补写需要另一个明确幂等协议，本轮不增加框架。若实施形成真实维护债务，记 `docs/exec-plan/tech-debt-tracker.md` 并更新本计划，不以预测冒充已登记。

## Idempotence and Recovery

同create key+规范IDs幂等，换IDs冲突；空/省略同义。原actor、sourceIssue选择、draft和IDs不由resume observer或当前form重建。创建恢复先观察原PR；只有稳定assignment record不存在且A未决槽允许时认领一次。已有pending/unknown只指定operationId resume；terminal只读。明确failed不会因读回而换key重试；权限修复后的新显式A添加具有独立intent，原失败证据保留。unknown不再dispatch，manual最新sequence不代替B。目标/授权/receipt变化fail closed并遮蔽人员。

回滚B恢复A事后添加，不撤外部负责人，不删DB证据。A修改后的运行artifact与其DB配对；原schema拒绝assignment时保留原库并明示未执行/未确认，不自动升级DDL或回填。回滚运行旧artifact使用其已验证备份/隔离库，不假装旧端接受新增requestedAssigneeIds；不添加双版本兼容器。先撤B再撤A，stack整理走既有恢复锚点流程。

## Interfaces and Dependencies

实际A Core契约：`AssigneeScope={workItemId:string,repositoryId:string,createOperationId:string}`；`AssigneeAdd extends AssigneeScope {actor:{kind:string,id?:string};idempotencyKey:string;assigneeIds:readonly string[]}`；`AssigneeResume extends AssigneeScope {observer:{kind:string,id?:string};operationId:string}`。`addChangeRequestAssignees(context:CoreContext,input:AssigneeAdd):Promise<AssigneeResult>` 与 `resumeChangeRequestAssignees(context:CoreContext,input:AssigneeResume):Promise<AssigneeResult>`；AssigneeResult的phase固定confirmed/reconciled/unknown/failed/conflict，另有可选operationId/error。ProviderCapabilitySnapshot的可选 `permissionVersion?:Readonly<Partial<Record<CapabilityKey,number>>>` 仅供A/runtimeAccess的当前授权围栏，不改变上述公开命令签名、UI选人port或持久数据形状。`getChangeRequestAssigneeOperation(context,AssigneeQuery):Promise<AssigneeOperation>`为本地读，必须传稳定record的operationId。

实际client端 `creator.assignees?:ChangeRequestAssignees` 有 `options(scope:DeliveryLineageScope,cursor?:string):Promise<AssigneeOptions>`、`operation(scope:AssigneeScope,operationId?:string):Promise<AssigneeOperation>`、`add(scope,ids):Promise<AssigneeWrite>`、`resume(scope,operationId):Promise<AssigneeWrite>`。client scope额外含workspaceId；options有targetStamp/items/nextCursor；operation有kind，operation分支含operationId/targetStamp/state/requestedIds/confirmedIds。B不改这组port；事后add仍由A随机key。实际picker签名为 `ChangeRequestAssigneePicker({scope:DeliveryLineageScope,port:ChangeRequestAssignees,connected:boolean,value:readonly string[],onChange:(ids:readonly string[])=>void,disabled?:boolean})`，父key承担accessToken失效。

B增量契约：`CreateChangeRequestRequest`/client `ChangeRequestIntent`加 `assigneeIds?:readonly string[]`；Host positional create在现有actor/key/workItem/repository/base/title/body/draft/issueRelation/issueTargetStamp之后追加此参数，undefined归空；原参数顺序与语义保持。`ChangeRequestExternalIntent`根加 `requestedAssigneeIds?:readonly string[]`，仅非空保存/入canonical，issueSelection/draft/input与A assignment.intent.sequence保留现状。`PrOperationView`/client operation新增requestedAssigneeIds和下述摘要，原issueRelation/issueTarget保持授权遮蔽。

结果/读数新增 `assignment?:{state:'none'|'pending'|'confirmed'|'unknown'|'failed'|'conflict',operationId?:string,reason?:'not_supported'|'permission_denied'}`；这是独立摘要，不进入create intent。A saved→confirmed，pending→pending，unknown/failed/conflict保持；稳定记录缺失但仍待第二阶段为pending，读取被阻断不带旧IDs/身份；无原IDs为none。安全reason只表达已知的负责人准入/写拒绝，不能用其替代create phase或relationState。client严格白名单新增该对象，operation/requestedIDs也严格校验。

内部 `continueCreationAssignees(context:CoreContext,scope:PrScope,createOperationId:string):Promise<NonNullable<CreateChangeRequestResult['assignment']>>` 从已确认原create解析actor/IDs并走实际A add/resume；本地摘要helper只查稳定key，不调用外部方法。Core create/resume共同返回保留ref/entityId/phase/relationState的结果，Host finishChangeRequest继续最后核验。Provider、003 DDL、A的receipt/sequence算法和sourceIssue helper均是既有依赖，本叶子不再发明替身。

## Outcomes & Retrospective

Fix round 1 在当前 scope 内消费最新且匹配的 Host assignment；等待、blocked、unknown 与不匹配读数均遮蔽旧写响应的成功，同时同一已确认 PR 继续独立显示。真实浏览器的来源权限元数据变化保留 base/title/body/Draft 与在途消费者，晚到目录结果不回显、断连不出现创建入口（原浏览器仅等待已不存在的候选，完整响应完成边界的证据 Superseded by test-only 时序闭合：等待相同原 Request 的 HTTP 响应 finished 及渲染帧后再断言，2026-11-07）；已建 PR 的 native assignment 403 仍显示 PR 确认与单独失败。部分人员读回和非空 IDs 的 definite create refusal 也有 B 组合判别，Planning 投影前后相等且原 actor 保留。浏览器关系三态使用合成来源 target 与真实 native PR provider/Host/SQLite；原生 Planning target decoder 由既有 Host 三态测试覆盖。

Task 1 已在 `feature/pr-assignee-creation` 完成生产 Core/controller/Host/client/UI 与 SQLite 浏览器闭环。非空原生 IDs 首 await 前冻结并进入 create canonical，PR 确认后按稳定键复用 A；assignment 不写回 createReceipt。Issue 三态、Draft 和权限恢复继续由原链路处理，负责人失败/遮蔽保留已确认 PR。所有外部行为使用合成平台；没有真实 GitHub mutation、模型执行或安装人类验收。Task 2 仍须独立审查、变异判别及最终远端回读，当前计划保持 Active。

已知 UI 边界：picker 若在 Start Work 尚未就绪时首先读取目录，会显示既有安全重读入口；浏览器通过“重新读取负责人候选”显式恢复后用 Tab/Space 选择，没有修改 A picker 协议（原需正常开始工作后人工重试的结论 Superseded by Fix round 1：结果通知仅局部重挂 picker，正常就绪后自动出现候选；权限拒绝后的显式重读仍保留，2026-11-07）。双 SQLite Core 并发竞争时失败方可保守冲突/未知，后续原操作读回收敛，实际仅一个 stable record 与一次 add。

以下为开工前计划同步时的历史结论，关于 B 尚未实施的陈述 Superseded by 本节 Task 1 实际结果（2026-11-07）。

本次只完成对A实际契约及当前main的计划刷新与独立重读，B尚未实施。原design-a/design-b/product-design仍为同一三份独立设计输入，本次是契约/主线同步，不增加设计轮数或替代A评审。A的代码量/全量结果属于其自身记录，B不能沿用作自己的验证，也不宣称A独立review已完成。B开工必须读取A最终clean head；最终按当前B head记录命令/输出/局限，合成组合不代表真实token或安装人类接受。完成后按PLANS归档，Planning接受由人类决定。

## Bottom Change Note

2026-11-07 SGT：首次综合三份设计，收敛为A上的创建预选闭环；当前接口细节 Superseded by 下条实际A刷新。

2026-11-07 SGT：对齐A@a140f57b/main@50abd7d7的Core/ports/picker、003 CHECK与sequence裁定；保持sourceIssue/draft/creatorAccessToken，修正随机key/latest discovery/createReceipt漂移风险；仅修改本运行态B计划，未写正式工作树或实现。

2026-11-07 SGT：以开工PR/head/base回读取代旧固定SHA前提；继承A公共权限出口与易失permissionVersion，明确failed原记录只读/新显式intent重试；核对main Host/client ABI无新增冲突、test runner与push-only路径同步，净B预测720行。

2026-11-07 SGT：开工前接合A已独立复核的docs-only归档，关联改completed路径；上层非默认base的Closes文字未形成连接，使用GitHub官方addCloseIssueReferences后已双向回读。PR581仍Draft，开始TDD前先保存当前计划。

2026-11-07 SGT：产品 TDD 期间发现 typed remote 固定 ABI 快照也消费 create 形状，扩入唯一文件集并同步参数数；记录首轮完整验证失败，最终结果待本轮收敛。

2026-11-07 SGT：完成 Task 1 TDD 与本地最终三层/浏览器验证；修订阶段二摘要公共出口、末次 await 重新核验、原 actor 严格碰撞和空选择可选参数表示。计划保持 Active，交独立 Task 2 验收；未执行远端写入或人类安装接受。

2026-11-07 SGT：独立 Task 1 review 指出旧 assignment 写响应覆盖新 Host 摘要 P2、正常 Start Work 后候选需人工 retry P3。Fix round 1 扩入最小 UI 通知透传范围，以具名 RED 修订并补部分分配/创建拒绝组合；旧5675ce92验证保持历史，当前源码须重新验证。

2026-11-07 SGT：Fix round 1 完成 P2/P3、父层 scope key 与明确两 Core 组合；真实 carrier 浏览器 11/11，当前源三层验证 1404/2072/226 全绿。独立最小 HTML 的中文原生 select 键盘实验是自动化局限，不计产品 RED；三态证据按实际 selectOption/Tab 记录。

2026-11-07 SGT：按 scoped re-review 的非阻断 P3 建立精确原 options 请求响应完成屏障；仅改浏览器证据与本计划，具名 1/1、完整 11/11。生产/其它测试层/fixture 与已审阅548f05f逐字不变，沿用原三层证据并保留全部旧日志，不宣称重跑 verify。
