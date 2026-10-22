# 工作项抽屉执行上下文与运行状态 ExecPlan

> 状态：Completed · 两项 P2 修复已获独立复评 APPROVE；新提交门禁由协调者回读
> 创建：2026-10-22
> 范围：#282；Host 已记录的执行事实经真实插件到达安全工作项抽屉
> 规范：`PLANS.md`；上游依据：#282、`docs/product/vertical-path.md` §2 第 8 步

## Purpose / Big Picture

用户在实际 Harness 插件打开工作项详情时，可以看到对应仓库的工作树路径、分支和运行状态。
人工承接仍提供可继续工作的路径与分支；主执行失败与人工承接分别表达。
成功证据必须串联 SQLite → Core → Controller → Host remote → 生产 client 注册的 Panel → 原生详情抽屉，不能只给组件手工传数据。
本切片读 Host 已持久化的最后记录，打开、重新连接或点击“刷新执行状态”时重读；不承诺执行平台实时推送。

## Context and Orientation

调查基线：2026-10-22 09:16 +08，`feature/drawer-execution-state` 从 `main@d7e7bca6aae31a4329f3238d3b90274dd683516c` 隔离；后续按验证命令重新锁定检出。
`packages/core/src/execution-context.ts` 的 `readExecutionContext` 已读 context 和 `runIdFor(contextId)` 的运行记录，却没有返回 run.status。
上下文状态表达工作环境是否准备好；运行状态表达会话进度。Ready 上下文可以对应 failed 或 succeeded 运行。
`packages/controller/src/queries.ts` 已原样转发 `getExecutionContext`，无需新建第二个 Controller 查询。
`apps/harness-plugin/src/host-operations.ts` 是远程操作唯一声明；生产 `client.ts` 当前仅注入 workspace watch。
`packages/ui/src/work-item-app.ts` 持有唯一 scope 门和路由；project 组合唯一 drawer；ui-model 先过可见性门再产生白名单详情。
`ClientWorkspaceRead.repositories` 提供已登记仓库集合；省略同时可能表示未登记或帧未携带，不能当作确定没有执行上下文。
`worktreeExternalId` 当前由 Local Git 的确认路径填写；显示该已确认文本，不从请求拼路径。
ADR-0008 仍标 Proposed；本计划遵守已实现的 run 身份及 fallback 来源，不改变 ADR 状态。
#229 的生产详情入口已在基线；本 PR 不依赖 #389，也不依赖 #335 或其它未合并分支。

## Design / Spec

采用按需精确查询。放弃把 context/run 塞进 Planning snapshot/watch：它会扩大列表路径披露面、帧验证与修订语义，而运行变化并不保证推进 Planning revision。
放弃从 StartWorkResult 缓存或 Provider 实时查询组装页面：重启后事实会丢失，且越过 Host 本地权威。

Core 的 `ExecutionContextView` 增加恒有、值可 undefined 的 `runStatus: ExecutionRunStatus | undefined`，直接赋 `run?.status`。
保留原生 queued、starting、running、succeeded、failed、canceled、timed_out、unknown；UI 将 succeeded 译为“已完成”。
缺运行记录显示“尚无运行记录”；unknown 显示“状态未知”；不得从 context.status 或 degraded 反推运行结果。
人工承接只来自运行记录 fallback，经既有 `fallbackOf` 返回 `manual_fallback`；可以与 running 同时出现。

Host 在 OPERATIONS 追加 unary `getExecutionContext(workItemId, repositoryId)`，只接受两个非空字符串，exactRecord 拒绝未知键。
查询没有 actor/idempotencyKey，不接受 workspaceId；工作区由 Host composition 固定。
handler 先用 `queries.getEntity` 确认 `content.contentKind === work_item`，读取 context 后再复验；PR、redacted、缺失条目均返回无上下文。
结果使用 `{ context: null | dto }`，固定顶层空值编码，避免跨 remote 时 undefined 丢失。
DTO 仅白名单保留 workspaceId、workItemId、repositoryId、status、branchExternalId、worktreeExternalId、runStatus、fallback；可选值省略。
不返回 providerRef、命令、环境、完整错误；读取失败经现有 guarded 固定文案上 wire。

client 新增 React-free 的 `ExecutionContextReader` 与 decoder；状态类型复用 domain 值，允许 type-only Controller 类型，禁止 Core/Provider 运行时依赖。
decoder 验证普通对象、白名单、必需 scope 字符串、可选字符串及状态枚举，拒绝未知枚举和跨 workspace/item/repository 回指。
remote 失败必须先解包为失败；不能把 RemoteResult 当 DTO cast。UI 只显示固定“暂时无法读取执行状态”，不回显原始异常。
生产 `client.ts` 创建 reader 并注入 `bindWorkItemApp`，沿 App → ProjectPage → Drawer 传递；既有不传 reader 的壳保持只读详情可用。

ui-model 在 `WorkItemDetailContent` 增加可选 executionTarget，只能在 scope、列表门、详情复验都通过且 contentKind 为 WorkItem 后生成。
target 包含当前 workspaceId、workItemId 和稳定排序的 repositoryIds；仓库取 read.repositories，不能猜默认仓库或选首项。
PR、redacted、loading、unresolved、unavailable 的白名单不含 target；UI 无 target 时不挂执行组件、不查询、不渲染旧结果。
每个已登记 repository 显式查询；有多个 context 则按 repositoryId 排序逐段呈现，各段带仓库标识。
明确查得全部 context 为 null 才显示“尚未开始工作”；仓库元数据缺席显示“仓库信息尚未提供”。
单仓库失败不冒充其它仓库没有 context；各段分别显示读取失败，保留其它成功结果。

执行组件只持局部 loading/loaded/unavailable 状态，不建立全局事实缓存。
请求键包含 workspaceId、itemId、排序后的 repositoryIds；局部状态也带键，render 时不匹配便不显示旧值。
每轮 effect/刷新有代次与 cleanup；A→B、workspace/仓库集合变化、关闭、撤权、PR 替换及卸载均使旧代次失效。
resolve 和 reject 都先检查代次，A 的晚结果不能进入 B；cleanup 后的拒绝仍被消费，避免未处理 Promise。
断线时当前仍可见目标可保留最后读数并标“最后已读”，禁用刷新；换目标清空，恢复后重新 query。
重复刷新由同一局部代次收敛，不增加轮询或新的全局队列。

每段显示路径、分支与运行状态；缺路径/分支各给中性占位，不拼 file URL、shell 命令或 HTML。
人工承接额外显示“人工处理，可在该工作树继续”，保留路径与分支，不用 alert，也不把 degraded 全部解释成错误。
失败运行仍显示路径与分支。新增刷新按钮保留原生 dialog 的焦点、Escape 和 Tab 行为。

## Global Constraints

Host 是事实拥有者；本切片零 Provider 调用、零持久化写入，不改变 Planning 状态、修订、绑定或关系。
UI 不 import Core/Controller/Provider 运行时；client 不依赖 React；浏览器产物不能包含 Node/Core/Provider。
不实现 #142 Start Work 对话框、#215 取消、执行事件写者、自动轮询、日期验证或兼容迁移。
一个 PR 独立验收、合并、回滚；实现加测试 additions+deletions ≤800，文档 ≤1300；不以删掉生产接线或异步隔离压规模。
受控文件集：`packages/core/src/execution-context.ts`；`packages/domain/src/browser-values.ts`（既有纯值出口重导出两类执行状态）；`packages/client/src/execution-context.ts` 与 `packages/client/src/index.ts`；`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui-model/src/execution-context.ts` 与 `packages/ui-model/src/index.ts`；`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/execution-context-section.ts`；`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`。
测试集：新增 `tests/integration/execution-context-run-status.test.js`、`tests/integration/harness-plugin-execution-drawer.test.js`、`tests/contract/ui-execution-context.test.js`，必要浏览器 fixture 放 `tests/fixtures/execution-drawer-browser.mjs`；既有 Host operations 与详情精确白名单测试只改受影响断言。
正式文档限本计划、`docs/README.md`、`docs/product/vertical-path.md` 第 8 行证据；新债务才追加 `docs/exec-plan/tech-debt-tracker.md`。
#335 实现者是 `apps/harness-plugin/src/host-operations.ts` / `apps/harness-plugin/src/host-composition.ts` 的唯一 owner，顺序完成两分支适配；本任务实现者拥有 Core/client/UI 与专用测试，准备 Host 契约后等待 owner 在本工作树集成。父任务协调，两个 PR 各从 main 验证，不依赖合并彼此。
预计 Core/查询 70 行、Host/client 140 行、UI/model 180 行、测试 330 行，留 80 行整合余量；超预算先合并重复夹具及断言。

## Plan of Work

全部命令在检出 `feature/drawer-execution-state` 的工作树根目录运行；隔离目录为 `.worktrees/drawer-execution-state`。
开始和恢复时执行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`，确认目标与忽略规则。
先读 `docs/development/workflow.md`、`docs/review/README.md`、`docs/development/publication.md`；有需求歧义才返回用户，普通命名在 Decision Log 记录后继续。

### Batch 1 · 运行事实通过现有查询

最小闭环：两种 Storage 的 Controller 查询都返回 Core 记录中的运行状态。
涉及主文件：`packages/core/src/execution-context.ts` 与 `tests/integration/execution-context-run-status.test.js`。
先写失败测试，再增加 runStatus；覆盖 running、failed、succeeded、manual_fallback+running、无 run。
用同一用例验证 provider 状态改变不改变本地查询结果、查询前后记录和修订不变、Provider 调用为零。
验证：`node --test tests/integration/execution-context-run-status.test.js tests/e2e/controller-roundtrip.test.js`；期望选定用例非零且全通过。
回滚：撤回本批字段与测试，不修改数据库。

### Batch 2 · Host 查询与安全目标

最小闭环：合法目标经实际 remote 解包和 decoder 得到白名单结果；不可见或错误目标没有路径。
涉及主文件：`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`packages/client/src/execution-context.ts`、`packages/ui-model/src/work-item-detail-view.ts`。
先测 nullable wire roundtrip、坏参数/未知键、坏枚举/类型、scope 回指错、PR/redacted、读取期间撤权，再补 handler/decoder。
测试按 operation 名找 descriptor，不把总数固化成偶然常量；沿用唯一 OPERATIONS 派生，禁止手写第二份列表。
验证：`node --test tests/integration/harness-plugin-execution-drawer.test.js tests/contract/harness-host-operations.test.js tests/contract/ui-work-item-detail-view.test.js`；期望输入失败不触业务查询，敏感结果为空。
回滚：撤回新增 operation、reader 和 target，保留原 watch/详情；与 #335 无字段互相替换。

### Batch 3 · 真实抽屉与异步隔离

最小闭环：生产 apply 注册的 Panel 打开条目并通过 Host 本地记录显示执行段。
涉及主文件：`apps/harness-plugin/src/client.ts`、`packages/ui/src/execution-context-section.ts`、`packages/ui-model/src/execution-context.ts`、新增插件集成与 UI 契约测试。
先做真实 Panel 浏览器验收失败样本，再接 reader；覆盖人工承接、失败、完成、多仓库、刷新、断线和恢复。
用可控制 Promise 做 A 慢/B 快、撤权后晚成功、关闭/卸载后晚拒绝；首帧就不得出现旧路径，不能只靠 SSR 证明 effect。
验证：`node --test tests/contract/ui-execution-context.test.js tests/integration/harness-plugin-execution-drawer.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js`；期望实际浏览器事件全通过且焦点/Escape 不退化。
验证：`node --test tests/integration/harness-plugin-artifact.test.js tests/contract/package-boundaries.test.js`；期望生产包边界与安装产物契约通过。
回滚：撤回本批 UI 接线与测试，原详情仍可用；不删除用户工作树。

### Batch 4 · 独立验收与交付

最小闭环：独立审阅者能按证据重放本 PR，不依赖其它分支。
涉及主文件：本计划、文档索引、纵向路径第 8 行；只在已证实位置追加 Superseded 标记，保留其它未交付边界。
执行 `pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`；期望全部通过。
执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；期望零问题，并人工复核发布面五类目。
按实际 diff 重新计算实现/测试与文档行数；当前 800/1300 限额比仓库默认更严。
整理可独立审阅提交，按仓库中文 Conventional Commit 规范引用 #282；建 draft PR，描述闭环、ExecPlan + Batch、验证、风险与回滚。
最终 push 后执行 `gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,reviewDecision`、`gh pr checks --repo SingularityKChen/harness-projects`，并回读全部 review threads。
精确 head 的必需 checks、issue 关联和独立审阅均通过才 ready，保持未合并；更换 head 后全部重新锁定。
回滚：审阅阶段保留 draft 并修复；需要撤销能力时整体 revert 本 PR，已有记录不变。

### 评审修订 · 同目标读取恢复与判别性回归

初审 F1/F2 均为 P2：仅修改 `packages/ui/src/execution-context-section.ts`、`tests/contract/ui-execution-context.test.js` 及本 PR 文档。
同 key、同 repository 保留最后成功结果（包括 null），refreshing/error 与已读事实独立；成功替换该仓库，失败保留并标最后已读。目标/仓库集合变化清空，撤权/断线旧响应仍失效，不增加持久缓存、Provider 调用或公共接口。
先补回归并看到旧实现丢路径的失败，再实现；新目标完成后排除旧 canary，逐仓库唯一断言，同目标两次刷新逆序与断线/重连反例。
验证：`node --test tests/contract/ui-execution-context.test.js`（旧实现 5/6，修复后 6/6）；三份目标文件 10/10；`pnpm verify`（1772 + MVP-0 7）；统一六项变异全 KILLED 并字节恢复；生产 Panel/Host/SQLite 浏览器覆盖先成功后失败仍保留四项、换目标/PR/撤权/断线晚响应和重连，规划 revision 1→1。
回滚：仅撤回本次 Section 与测试修订；已有存储与规划状态不变。实现 owner 不批准自己的修复，由协调者另派独立复评后整合提交。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| V1 运行来源 | 两 Storage → Controller 返回 running/failed/succeeded/manual；Provider 变更不影响查询 |
| V2 人工可用 | fallback+running 有工作树、分支和人工处理文案，无错误遮蔽；failed+非fallback不被误判 |
| V3 实际插件闭环 | createHostComposition + SQLite + installHostRemote + 生产 apply 注册 Panel + 浏览器打开 drawer |
| V4 安全条目 | PR/redacted/跨scope 无段、UI reader 调用为零；直接 Host 请求 PR/redacted 也无路径 |
| V5 异步隔离 | A→B、关闭、卸载、撤权、PR 替换的晚成功/拒绝都不显示旧路径、不产生未处理拒绝 |
| V6 多仓库 | 两 repositoryId 各自查询、路径/分支不混淆；缺元数据和全null分开表达 |
| V7 刷新与断线 | 本地 run 改 succeeded 后刷新见完成；断线标最后已读，恢复重读；规划状态/修订不变 |
| V8 decoder/边界 | nullable roundtrip、坏 enum/scope/extra 失败关闭；bundle 无 Node/Core/Provider 运行时 |
| V9 产品证据边界 | 第 8 行仅更新已记录状态的抽屉可见面，不声称会话启动、持续采集或全部 R1 已通过 |

## Progress

- [x] (2026-10-22 SGT) 初审两项 P2 已按授权完成 TDD 修复、最终变异和浏览器自验；当前 owner 不自批；另派独立复评已 APPROVE，交协调者整合。

- [x] (2026-10-22 09:16 +08) 两份独立设计与源码交叉审查，收敛按需查询和真实 Panel 验收。
- [x] (2026-10-22 09:16 +08) 决定 wire 空值、multi-repo、Host 可见性复验与局部请求隔离；计划落盘。
- [x] (2026-10-22 +08) Batch 1：双 Storage 查询覆盖八种运行状态、独立 fallback、无 run；四个 Provider 的所有方法换成抛错陷阱，查询前后记录、帧与修订不变。
- [x] (2026-10-22 +08) Batch 2：Host owner 顺序集成精确 unary；nullable JSON、坏输入、枚举与 scope、PR/遮蔽、查询期间撤权和固定错误文案完成。
- [x] (2026-10-22 +08) Batch 3：生产 Panel 接线、组件异步反例与 artifact/boundaries 已通过；真实 Chrome 浏览器已覆盖人工承接、运行成功/失败、刷新/断线/恢复、PR/遮蔽零查询、撤权后晚成功、关闭后晚拒绝、焦点与 Escape，零 pageerror。

- [x] (2026-10-22 09:54 SGT) 独立实现验收 PASS；实现 head `90bed2110e9f` 的 PR Fast Gate、四条 Merge Gate lane 与发布检查均通过；完成计划归档与索引同步。

## Surprises & Discoveries

2026-10-22 评审修订：初审 R3 迟到成功保护变异存活；补强后的跨目标完成断言在实施前已将其杀死，最终 R3 由同目标逆序用例归因，新增 last-success/null 两项变异也被杀死。初审刷新失败会清空已读路径的反例已先红后绿。

context Ready 不是 run Running，且 fallback 是独立记录字段；证据是 `readExecutionContext`、`fallbackOf` 与 domain 的八种运行状态。
真实客户端当前只有 watch 注入；只扩 Controller 或给 Drawer 测试传 prop 会留下生产不可达缺口，证据是插件 `client.ts`。
仓库元数据缺席不能证明未开始工作，证据是 `packages/client/src/workspace-read.ts` 的 repositories 契约。
安全详情 identity 可省略，不能靠 identity.kind 排除 PR；证据是 `work-item-detail-view.ts` 的可选 identity。
浏览器纯值出口原先未重导出两种执行状态；直接从 domain 根入口导入会触及 Node，所以只扩既有 `domain/values` 出口，复用同一枚举而不复制词表。
真实浏览器在遮蔽后恢复条目时，最初 opener 已脱离文档；关闭应按现有规则回到列表标题，再次从新 anchor 打开后 Escape 回到该 anchor。该差异是夹具断言修正，没有修改焦点实现。

## Decision Log

- Decision（2026-10-22，协调者转录根会话收到的人类原始授权，覆盖 PR #392–#395）：『如果没有且无 P0 / P1，或只有 P2/P3 → **你负责后续**：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合 commit → 核对并处理对应 issue → `merge_method=rebase` 合并。』Rationale：初审只有两项 P2，按此授权由当前 owner 修复、独立 reviewer 复评；收到直接人类授权的根协调会话负责提交整合、外部写入与实际合并。本子任务不执行这些动作；Planning Status 仍归人类，不作变更。

- Decision：最终 CI/ready 是易失的 PR 属性，归档文档保留回读命令，发布时重新锁定最新 head，不把实现 head 的绿灯转移给归档 head。Rationale：避免文档静态值与远端当前状态形成第二事实源。Date/Author：2026-10-22 09:54 SGT / 交付协调者。

D1（2026-10-22 +08，设计审阅）：采用 unary query；Rationale：复用本地查询，避免扩大 Planning stream 与路径披露面。
D2（同日，设计审阅）：选择 `{context:null|dto}` 与严格 decoder；Rationale：空值可稳定传输，坏scope不能靠类型断言进入 UI。
D3（同日，设计审阅）：safe executionTarget 替代把 raw entity 交给 UI；Rationale：只在既有安全投影内决定资格，不重复路由与身份猜测。
D4（同日，设计审阅）：逐仓库显示、手动刷新、局部代次；Rationale：多仓库不暗选，状态可重读而无需新全局缓存或轮询。
D5（同日，设计审阅）：Host 读前/读后复验 WorkItem；Rationale：调用方绕过 UI 或查询期间撤权也不能取回旧路径。
D6（同日，父任务裁决）：#335 实现者独占两份 Host 接线文件并顺序集成两分支；#282 实现者只改 Core/client/UI 与专用测试，先交 Host 契约；Rationale：同一架构单元只有一个 owner，两个 PR 仍各自从 main 独立验收。

## Idempotence and Recovery

查询、打开、关闭、刷新、验证均可重复，不创建工作树、运行或关系；持久化输入只由测试夹具在隔离临时库构造。
失败读取保留同目标明确标注的最后读数；换目标或撤权立即丢弃。未知 DTO 失败关闭，不退回 raw detail 或其它 scope 缓存。
测试失败先保留失败样本，按批次撤回工作集；不 reset 共享 main、不清理非本任务文件、不删除用户仓库。
没有 schema 变更与数据迁移。持续 run 状态采集属于其它执行生命周期工作，本次不临时加缓存或双写绕过。
若发现必须延期的可靠性/测试缺口，记入 `docs/exec-plan/tech-debt-tracker.md` 并在验收表标未通过，不能用债务代替 V3–V8。

## Interfaces and Dependencies

依赖 Node ≥22、仓库锁定 pnpm、已有 React/esbuild/浏览器 fixture 与 SQLite；本地测试不需要真实 GitHub 凭据。
remote 方法名及参数来自 OPERATIONS；decoder 类型放 client，展示映射放 ui-model，Host 权威留在 composition/Controller/Core。
依赖已在 main 的 #229 入口；#142、#215、#335、#389 均不是本 PR 前置。
外部 PR 发布使用已授权 GitHub actor；不得修改 Project Status 或依赖关系，也不自行合并。

## Outcomes & Retrospective

2026-10-22 评审修订已自验：完整 `pnpm verify` 为 typecheck + 1772 测试 + 7 MVP-0，全部 exit 0；最终六项已归因变异全 KILLED，字节恢复；真实生产 Panel/Host/SQLite 浏览器显示失败后保留路径、分支、运行状态和人工处理并标最后已读，目标/撤权/断线晚响应不泄露、重连读新状态，规划 revision 1→1。修复仍是未提交工作树，独立复评和新 head 门禁交由协调者，不能沿用旧 head 批准。

实现已连通 Core → Controller → Host remote → 严格 client reader → 生产 apply 注册 Panel → 原生抽屉。新增查询无数据库迁移、无 Provider 调用；运行状态与 fallback 独立。
TDD：初次 Core 双 Storage 因 `runStatus === undefined` 失败，reader/target/Section 因缺少函数或字段失败；fixture 纠正后，真实 Host operation 与生产 Panel reader 注入也观察到缺失失败。补最小实现后相关 Core/Controller/UI 回归 50 项通过，artifact 与 boundaries 32 项通过。Host owner 集成后真实 Host/Panel 两项通过；完整 `pnpm verify` 首轮 1769/1770，仅旧 `domain/values` 四项精确白名单因本次新增纯值出口失败；同步为六项并保留逐一同引用断言后重跑通过（1770 项 + MVP-0 7 项）。
真实浏览器使用 `execution-drawer-browser.mjs` 的生产 apply Panel 与真实 Host/SQLite JSON 桥；Chrome 155.0.8059.39，11 类检查通过，10 次精确查询、零 pageerror，规划修订始终为 1。首次浏览器运行在 Host owner 尚未接线时因缺操作失败；集成后焦点夹具按实际 opener 生命周期修正。
命令：`pnpm verify`（typecheck + 1770 tests + 7 MVP-0，exit 0）；`pnpm run boundaries`（9）；`node scripts/workflow-check.mjs`（8 个文件，无发现）；各批上述 `node --test` 命令均已运行。
完成后记录实际命令、检出、当前 head 与偏差；重新评估债务，移入 completed 并更新索引。

最终交付记录（2026-10-22 09:54 SGT @ `90bed2110e9f`）：独立验收通过，当前实现 head 的 PR Fast Gate、Integration/E2E/MVP-0/Boundaries 四 lane 及发布检查成功。归档只改变文档，产品文件与该验收树相同。最终归档提交仍须重新执行 `gh pr checks 395 -R SingularityKChen/harness-projects`，并回读 head/base、issue 双向关联和 review threads；通过后执行 `gh pr ready 395 -R SingularityKChen/harness-projects`。ready 和合并状态只以 PR 实时结果为准，Git 回滚不撤销 Project 元数据。


并行集成证据（2026-10-22 SGT，主线基线 `d7e7bca6`）：在 `test/iteration7-8-integration-preview` 临时检出组合本轮四个产品输入后，typecheck、1806 项测试与 7 项 MVP-0 通过；再加现有 PR #388–#391 的固定产品输入后，resolution-check、1868 项测试与 7 项 MVP-0 通过，未发现行为失败。四项输入分别为 #335 `2caa1842`、#282 `90bed211`、#297 `9cfb438f`、#362 `85fa379c`；已有四项为 #388 `6b855c41`、#389 `a8fe6d2d`、#390 `2d6547b8`、#391 `8515d8b9`，均为本次观察输入，不能视为永久远端 head。

两项 Host 能力之间有四处机械冲突：`host-composition.ts` 的 factory 要同时保留捕获 workspace 的 getExecutionContext 与共享单飞的 refreshPlanning，`host-operations.ts` 要同时声明两项精确参数；两份 Host operations/remote 契约保留双方断言。`watch` 仍在末尾，stop/drain/close 与前后可见性检查保留。当前四个已有 PR 仅需保留全部文档索引/债务追加；client/ui-model 的新增出口自动合并，无新增 API/兼容层依赖。预演只写临时 worktree，未修改或合并任何 GitHub PR。

## Bottom Change Note

2026-10-22 09:16 +08：综合两份独立设计与生产调用链审查创建计划，固定实际插件闭环、多仓库、空值解码和撤权/乱序边界；未实施产品变更。
2026-10-22 09:20 +08：落盘复读后补全受控文件相对路径；本仓库 13 章节为准，通用技能 linter 的额外章节要求不适用。

2026-10-22 +08：按已批准设计完成 Core/client/UI 与 Host owner 顺序接线；记录实际红绿路径，扩既有 domain 纯值出口；保留 active 等待当前实现验证与独立验收。

2026-10-22 +08：真实浏览器 11 类检查通过；完整 verify 1770 + MVP-0 7、boundaries 9 与 workflow-check 8 文件通过。计划保持 active，交给父任务进行独立验收、最终发布与当前 head 回读。

2026-10-22 09:54 SGT：回填独立验收、实现 head 远端门、收敛提交边界并归档；最终归档 head 与 ready 使用实时回读命令，不继承旧绿。

2026-10-22 SGT：按初审 F1/F2 完成两文件最小修复与先红后绿，记录人类原始授权转录、1772+7 验证、六项变异和真实浏览器恢复证据；评审记录收敛，保留独立复评与新 head 回读门。

2026-10-22 SGT：协调者转录独立复评 APPROVE，无新增问题；组件/详情30/30，独立三反例共9/9，四项变异全KILLED并按归因恢复。复评锁定的 Section SHA256 与本地实算一致；当前仍不提交或外部写入，新 head 由根协调会话整合后重锁。

2026-10-22 最终整合：在真实 `main@5f4dcbe6f080d30b9df3e1cddd4832ff03a1e9ca` 上保留 #394 refreshPlanning 及生命周期边界，并保留本 PR 的 workspace 绑定 getExecutionContext。四文件冲突已解，产品 Git blob 清单与1808+7通过的修复并集 `a4440bd45b725d7f2c398127200db765bab49c06` 完全一致；当前 head 的独立复核及远端门禁不沿用旧批准。证据见 `docs/review/pr-395-mmp-review.md`。
