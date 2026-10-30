# Delivery 运行时读访问隔离 ExecPlan

> 状态：Completed（本层及必要上层#481的本地独立验收通过；最终远端门按末次head回读）；创建：2026-10-30（Asia/Singapore）。
> 范围：已发货交付谱系的按能力拒读、离线保留、迟到提交和已开详情失效。
> 关联：Closes #468；Refs #465、#457；本切片独立验收 Delivery 读侧，#457 继续由后续 operation/browser 切片总验收。
> 归档位置：实施时落入所属工作树 `docs/exec-plan/active/2026-10-30-delivery-runtime-access.md`，按根 `PLANS.md` 维护。

## Purpose / Big Picture

同一工作区的 Delivery 临时离线时，用户继续看到获准的最后确认 CI，并明确标为陈旧；Planning 与 Start Work 继续可用。某个读能力被明确拒绝时，只遮住它保护的集合及依赖该锚点的内容，其它获准集合仍可读。已打开详情不能从旧本地请求或缓存重新显示被撤销的 label、externalId 或 CI fact。

最小证据是 PipelineRead 拒读而 CheckRead 保持可用的判别 pair、反向 pair、Storage 失败仍 fail closed、旧成功/旧失败不改新状态，以及真实生产 Host/remote/client/render 的同域恢复。此 PR 不需要后续写门或浏览器才能证明这个读侧闭环。

## Context and Orientation

本计划依赖 Planning 运行时访问切片的单一 Core runtime owner：当前实际 API 为 epoch/denied/registry/probeRegistry、deny(captured)、recover(captured, verified?)、error() 和 local(work)，目前只作用于唯一 Planning 挂载。本切片有界扩展 binding/key/repository scope，同时保持这些 Planning API 语义；具体接口以同仓 `docs/exec-plan/active/2026-10-30-planning-runtime-access.md` 或完成后的同名 completed 文档及实际源码为准。不能另造 Delivery 权限数据库或前端 permission map。

2026-10-30 在 `7907efbbdc5e35cc8ea4769c7067e885cec844e1` 调查：`packages/core/src/chain-facts.ts::gated` 把 ProviderErrorCode 丢成 reason；`delivery-facts.ts` 遇任何 gap 都保留旧集合；`delivery.ts` 即使 unavailable 仍返回受保护节点。原本的 stale 模型不等于拒读遮罩。

`refreshDeliveryFacts` 是唯一事实写者；它在事务外读 Provider，事务内按 attemptedAt 防乱序并替换四集合：commit、change_request、pipeline_run、check_run。attemptedAt 是普通读取排序令牌，不能替代访问 epoch。关系沿现有身份传播，查询不重识别或写库。

`packages/ui/src/delivery-lineage-section.ts` 有局部读缓存，effect 仅依赖 scope/connected/reader；Host metadata 改变不会自然清空它。`packages/ui-model/src/work-item-detail-view.ts` 与 `packages/ui/src/work-item-detail.ts` 是向已有 section 传纯失效 token 的最小接线。

实施分支为 `fix/delivery-runtime-access`，base 是实际 Planning PR head；Planning 合并后改 base 到最新 main 并重跑。开始时在该工作树根回读 `git status --short --branch`、`git rev-parse HEAD origin/main`，将实际 base 和接口记入 Progress，不能假设调查 SHA 仍是主分支。

## Design / Spec

2026-10-30复审边界：当前层的持久健康和本owner版本门不保证跨owner最终返回一致性；原Memory/SQLite与双Host探针已复现。该P1由必要上层 `fix/delivery-read-fence` / PR #481 的同步committed Storage fence闭合。当前层不提前关闭#468，用户评审/合并应连同上层验证；#481不增加第二权限源。

### 结构化失败与唯一访问判断

内部 CapabilityGap 增安全 ProjectErrorCode，保留 key 与实际服务 binding；Provider 原始 message 不进入 wire。DeliveryRefreshGap 可以带闭集 code，但只使用固定 key/layer/retry 说明。通过同一个 runtime owner 观察操作结果；当前 shipped 读范围是 DevelopmentRepositoryRead、DevelopmentChangeRequestRead、DeliveryPipelineRead、DeliveryCheckRead。

target 明确取已选择的 repositoryId，不按 provider 名猜。仓库局部拒绝不能污染另一个仓库；不同 binding/key 不能互相解除。Planning 的单一 scope 无需预先泛化，实现本切片时给 owner 增有界 target 参数即可。既有 workspace capability 描述仍表示挂载声明，目标的有效门复用 `repositories[].capabilities`，不新增第二份权限事实。

显式 refreshDeliveryFacts 对 runtime denied 的已实现 key 可做真实只读重新验证，但不能绕过 capability 缺失或 policy 禁止。成功仅清除同 binding/key/target、在 denial 后开始且完整读完的观察；静态 describe、另一 key 或另一 target 的成功均无效。

### 跨 owner 读健康与返回一致性

同一 owner 的 Map 仅是 `SyncCursor` 读健康的内存投影。复用已有 `(workspaceId,bindingId,scopeKey)`，scopeKey 为 `JSON.stringify(['delivery.read', key, repositoryId])`；cursorValue 闭集为版本、denied、该版本已确认 workItem scopes 与未完成读 pending 计数。不存请求参数、Provider 原文或任意队列；下一次拒读递增版本并清 scopes，pending 计数随结果完成回收，完整新读可替代遗留未完成读证据。

Provider I/O 之前先持久化 pending，marker 未获 Storage ack 不发请求。普通 offline/不完整结果只结束 pending，保留获准节点/stale；明确拒读立即内存 fail closed，并独立提交读健康，节点 redaction 失败不丢拒读。若健康结果写本身失败，新 owner 从遗留 pending 发现读取未完成，不能借 descriptor 恢复；同 owner 的已观察拒读不能被更旧磁盘健康覆盖。每次纯查询都读取对应健康记录，既有 owner 也观察其他 owner 已持久的新版本，不仅在 compose 时 hydrate。

成功读取本身仅结束 pending；只有事实与该 workItem scope 的恢复证据在同一事实事务成功提交，Storage ack 后才发布恢复。事务回滚不能使内存版本超前并提前恢复旧事实。读取票据同时带已捕获版本；旧 success/offline/denial 的持久更新须匹配当前版本，不能清新拒读。

Core 的同步 `getDeliveryAccessVersion()` 只投影同 authority 的 Planning/Delivery 内存版本，经 Controller 纯转发供 Host 将前后 scopeGuard 和投影置于同一复验闭环；最后异步 scopeGuard 完成后同步比较，变化就重读，比较与 return 间没有 await。metadata 同时复验两版本。逐仓库 `accessVersion` 从对应持久健康版本派生，经 wire 严格闭集解码；详情 token 纳入该值，使 available→denied→available 即使被 watch 合并也不能 ABA。

### 集合提交与读取

离线/Unavailable/RateLimited 保留已获准节点和 confirmedAt，仅标 stale。PermissionDenied 立即使该 key/target 进入拒读；本次涉及集合的 nodes 清空、confirmedAt 不作为当前可见确认外发，保持 stale/unconfirmed，而不是完整确认空集合。完整成功读到空集合仍是另一合法状态。

保留稳定实体、已记谱系与命令事实，不为权限变化删关系或重建身份。PipelineRead 拒绝只移除 pipeline；CheckRead 拒绝只移除 check。RepositoryRead 拒绝还阻断依赖它的 commit/PR/CI 展示；ChangeRequestRead 拒绝还阻断以 PR 为锚的 check。无关本地 execution_context/worktree 命令事实保留。

写者捕获相关操作 access epoch，提交前复验；尝试读取的普通 attemptedAt 规则继续有效。新 denial 使此前启动的成功不可提交；新完整恢复之后的旧失败被忽略。同一 publication owner 串行短本地提交，不锁 Provider I/O。

`getDeliveryProjection` 在返回前按当前目标访问过滤受保护集合及其 freshness/gaps，并复验 epoch；其它历史 scope 缓存也不能绕过。当前 scope 的 redaction 持久化失败时仍以 runtime 拒读遮住本地旧值，不谎报 applied。被遮集合的 CI fact 不能残留在 hop 或派生状态。

使用最小结构表达安全缺口：DeliveryGap 的拒读分支携 capability key、denying layer 和固定恢复说明；client 严格 decoder、ui-model 和 UI 同步接受闭集形状。不能将整个 projection.error 设为 PermissionDenied 后把其它可用集合一并锁死。无需改数据库 schema。

### 已打开详情与恢复

以目标对应的 Host capability 记录派生纯 invalidation token，随已有 detail view 传到 section；token 变化立即使旧本地 read 不可 render，并递增请求代次。token 只指示重读，不自行判许可。section 对新 token 做纯 Host read，不自动触发额外 Provider 写或形成刷新循环。

缓存按 key 遮罩：某 key denial 不要为丢一个 pipeline 把获准 checks 一起隐藏；新 Host 投影返回后接受允许的内容。临时断连/离线保留已获准旧内容并显示 stale。恢复按钮仍可显式发已有 refresh；晚 resolve/reject 不能安装到旧 token。

解释点名 key、permission/capability/policy 层、仍可读取的其它集合和显式刷新。原始异常、secret、本机路径不出 Project storage 或 UI。放弃整个 Delivery 清空和全工作区 read-only，二者违反局部降级；放弃 UI-only mask，Host 直接读仍会泄漏。

## Global Constraints

文件集：`tests/integration/pull-request-identity-convergence.test.js`（健康短事务后仍在事实事务前注入身份竞争），`packages/controller/src/wire.ts`、`packages/client/src/workspace-read.ts`（逐仓库安全 accessVersion 元数据闭集），`apps/harness-plugin/src/host-composition.ts`（返回前同 authority fence）、`packages/controller/src/queries.ts`（纯版本转发）、`packages/core/src/context.ts`（持久 read-health 接线）、`packages/core/src/runtime-access.ts`（仅目标扩展）、`packages/core/src/registry.ts`（仅 unavailable 固定层来源）、`packages/core/src/chain-facts.ts`、`packages/core/src/delivery-facts.ts`、`packages/core/src/delivery.ts`、`packages/core/src/queries.ts`（repository capability metadata）；`packages/client/src/delivery-lineage-reader.ts`；`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui-model/src/delivery-lineage.ts`；`packages/ui/src/work-item-detail.ts`、`packages/ui/src/delivery-lineage-section.ts`；新 `tests/integration/runtime-delivery-access.test.js`、既有 `tests/integration/harness-plugin-runtime-access.test.js`；必要既有 `tests/e2e/controller-roundtrip.test.js`、`tests/integration/delivery-repository-routing.test.js`、`tests/integration/harness-plugin-host-github-catalog.test.js`、`tests/integration/provider-binding-registration.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/e2e/delivery-lineage-strip.test.js`、`tests/integration/harness-plugin-delivery-lineage.test.js` 精确断言；本计划与 `docs/README.md`。不修改 Start Work provision 或 browser carrier。

每 PR 非 docs additions+deletions ≤799、docs ≤1299。预测代码/测试/config：结构码与目标 authority 70–110、事务/读取 140–190、client/UI 70–110、判别测试 230–290、现有断言 25–45，合计 535–745；尚非实际 diff。优先复用参数化用例和 seed，不新增新平台/缓存层。

没有发布旧实验兼容、migration、自动删除、policy 或规划 Status/关系写入。外部 Provider 仅读取；技术债不能替代本切片的 mask、epoch、Storage 失败或恢复验收。无需 #450/#451、UI detail/forms 或新视觉布局。

## Plan of Work

### Concrete Steps

### Batch 1 · 可重复的按 key 判别矩阵

最小闭环是 Core/fake/SQLite 测试明确区分 offline 与 PermissionDenied。主文件为新 `tests/integration/runtime-delivery-access.test.js`。复用已有 Ready execution/worktree/commit/PR/CI seed；先确认当前 denial 仍返回 canary 的红测试，再参数化两种 CI key、上游锚点 denial、不同 target/binding 的隔离和新完整恢复。

在检出 `fix/delivery-runtime-access` 的工作树根运行：

    pnpm test:file tests/integration/runtime-delivery-access.test.js

期望按保护内容断言先红而导入/seed 正常。Storage 拒写、旧读取在途→denial→旧成功、denial→新成功→旧失败均有明确 deferred；不以真实网络延迟代替排序控制。回滚为本批测试修改，无外部写。

### Batch 2 · 唯一写者与纯查询闭环

最小闭环是相应集合持久遮罩且任何查询不能绕过当前 key/target denial。主文件为 `chain-facts.ts`、`delivery-facts.ts`、`delivery.ts`。保留结构码，接 owner 观察、双令牌复验、事务 redaction 与纯读过滤；只由完整新读恢复。

在同一分支工作树根运行：

    pnpm test:file tests/integration/runtime-delivery-access.test.js tests/e2e/delivery-lineage.test.js tests/integration/harness-plugin-delivery-lineage.test.js
    pnpm run typecheck

期望新矩阵绿，旧 identity/partial page/attemptedAt 保护仍绿；denial 没有 fresh empty，无关 key/target 和 Planning/合法 Start Work 不受影响。回滚为本批完整读侧修改，保留 A，不部分回退 query mask。

### Batch 3 · 生产 client 和局部缓存

最小闭环是已开详情在 Host 权限 metadata 变化后放弃旧请求，允许集合仍可见，明确 retry 能恢复。主文件为 `delivery-lineage-reader.ts`、detail/lineage UI 和既有 Host runtime 测试。复用真 Host/SQLite/remote/watch/client apply，fault 仅在 Provider；Node renderer 驱动 opened section，不改 Controller 响应。

在同一分支工作树根运行：

    pnpm test:file tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/e2e/delivery-lineage-strip.test.js tests/integration/harness-plugin-delivery-lineage.test.js
    pnpm run boundaries

期望旧 token 的成功/失败都不 render forbidden canary；offline permitted nodes 仍显示 stale，permission 消失则明确缺口；Host baseline 和 client store 的 Planning 不变。隔离负控去掉 query filter 和 epoch fence，应各使对应用例红，恢复后全绿。回滚为本批 UI/decoder 接线，整 PR 可独立 revert。

### Batch 4 · 独立 PR 收口

主文件为本计划与 `docs/README.md`。整理提交，记录真实结果与实际 base，跑严格规模、发布面、远端回读后才 ready，不自行 merge。所有命令在该工作树根，base 以实际 Planning PR 分支为准；它合并后统一使用 origin/main。

    pnpm verify
    node scripts/workflow-check.mjs
    git diff --numstat origin/main...HEAD
    git diff --check origin/main...HEAD

上面 origin/main 仅用于 Planning 已合并的状态；尚未合并时以 `git diff --numstat <实际Planning-base>...HEAD` 和对应 rule-checks 的该 base 回读替换，实施者必须在活计划记下实际可复制命令。最终执行 `node scripts/rule-checks.mjs disclosure <实际base>`、`size <实际base>`，并独立累计非 docs ≤799/docs ≤1299。回读 PR exact head/base/checks/issue/review threads，Refs #457，不关闭总问题。回滚整 PR 保留 A。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| Offline | permitted CI nodes/facts/confirmedAt 保留而 stale；Planning 与新合法 Start Work 正常 |
| CI 局部 denial | pipeline/check 分别拒绝；仅相应集合消失且 key/layer 原因明确，另一集合保留 |
| 上游锚点 denial | RepositoryRead/ChangeRequestRead 对依赖集合传播遮罩，本地命令事实仍在 |
| 目标隔离 | 另一 binding/repository 不被污染；另一 key/target 成功不能解锁原 denial |
| 并发与 Storage | attemptedAt+epoch 均判别；旧成功/旧失败不能改新态；redaction commit 失败仍不外发旧值 |
| 已开详情 | 真 Host/client/apply/render，token 变化后旧 Promise 不装载；允许集合仍有事实，恢复无需 reload |
| 纯度与安全 | 查询零 Provider I/O/零写；无原异常/凭据；身份/规划状态/关系语义不变 |
| 交付 | narrow/full checks 与严格 A+D 实测达标；本地证据与 hosted CI 分列；#457 保持开放 |

## Progress

- [x] 2026-10-30（Asia/Singapore）：原跨ownerP1已在必要上层#481完成同步Storage fence与3项正式Core/Host回归，本层不提前关闭#468。


- [x] 2026-10-30（Asia/Singapore）：独立检查读链、唯一写者、投影与局部 UI 缓存，建立本计划。
- [x] 2026-10-30：重放到实际 A head `d9b669e5c3b2f29b185df8b8ae71ec2391670c10`（父 #204），保留新 A 安全栅栏与本计划 active 索引。
- [x] 2026-10-30：Batch 1 内容断言有效 RED，首轮 9 用例 8 红；最后矩阵 14/14 绿，包含两 Storage、目标/挂载/历史 scope、静态层、事务等待时撤权。
- [x] 2026-10-30：Batch 2 结构码、真实 binding/key/repository ticket、同 owner mask 与 epoch、事务回滚和纯读遮罩实现。
- [x] 2026-10-30：Batch 3 真 Host/SQLite/typed remote/watch/client.apply 与已开 section 的 late success/reject 通过；隔离复制 Core 的 query/epoch 负控分别 10/14、2/14 红。
- [x] (2026-10-30 12:47 SGT) Batch 4：独立修复复评、原反例6/新健康探针2/相关197、源码head15项hosted checks与双向closing468/空线程回读；归档后最终head继续同样检查后才ready。

## Surprises & Discoveries

`CapabilityGap` 原来只有 reason，无法区分离线与拒权；`DeliveryRefreshGap` 只有 key 是有意的安全边界，结构码扩展仍需坚持不转发 Provider 原文。`readDeliveryProjection` 原有 unavailable 标志并没有移除 label/externalId/fact，故不能只测试 flag。

Storage 只有按 context 获取/写 DeliveryFacts，无全库枚举 API；本切片不为全库批量清理加 migration。当前触达 scope 的 redaction 落库，其余历史 scope 由现有 SyncCursor 持久读健康的目标 mask 在权威 query 过滤；成功恢复只能针对同 scope/key 新读，不能使别处旧事实复活。

## Decision Log

- Decision：B 是完整 Delivery 读侧纵切；逐步写准入与唯一 browser carrier 移到 C。
  Rationale：原 B 630–830 预测越硬阈值，把写算法连同浏览器放另一可验收闭环可保留全部原验收。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。
- Decision：复用 current access owner、既有 repository capability 面和现有 fact writer，不加新 dashboard/Storage authority。
  Rationale：减少 context radius，目标和 key 的局部状态仍有唯一拥有者。
  Date/Author：2026-10-30（Asia/Singapore）/ 独立计划评审者。

## Idempotence and Recovery

重复 denied refresh 不恢复节点；同 scope 新完整成功才解除对应 mask；普通暂态失败不动许可事实。attemptedAt 排序保持，epoch 被替代的结果不提交。Storage 失败保留内存 deny，后续 refresh 可补安全持久化。

本 PR 可整体验证并 revert，A 保持有效；不得删库、清 credentials 或改上游权限来回退。负控隔离副本逐字恢复，清理只及本任务临时文件。

## Interfaces and Dependencies

Node ≥22、pnpm、fake/SQLite 与生产 Host typed remote，无真实凭据或上游外部写。A 已提供 Planning epoch/denied/registry/probeRegistry/deny/recover/error/local，保留其语义；B 增有界 DeliveryReadTicket、captureDelivery/currentDelivery/denyDelivery/recoverDelivery/deliveryRegistry/deliveryEpoch，地址为真实 binding/key/repository，恢复另须 workItem scope。C 会在 B 上 stack，使用同一 owner 和目标 metadata。

后续实际浏览器沿唯一 `tests/fixtures/execution-drawer-browser.mjs` 改造，B 不需要它先存在。#204 拥有 provision/execution，B 不修改该文件域；最终组合回读验证前端快照顺序，不能绕开 redaction 的职责。

Delivery 之外的 C 验收是同 issue 尚未完成的范围，不是本 PR 可接受的安全债务。若实现确实接受延期，按仓库 `docs/exec-plan/tech-debt-tracker.md` 登记，但不得降低本表关闭门。

## Outcomes & Retrospective

最终拆分事实：本层源head `d7cc8a311b383376766bd6e7aae2590849e79e18` 基于Planning `6207523`；代码A+D738。上层#481的 `de24119` 同时包含本层与最终Planning，完整 `pnpm verify` 2780/2780+MVP0 7/7，原跨ownerP1升级为MemoryCore/SQLiteCore/双真实Host3项有效RED→GREEN；独立复评F1–F4全部闭合。本层是持久读健康/隔离基础，#481才在#468 closing关联上提交完整跨owner返回保证；合并与回滚应按已记录栈顺序，未经人类评审不合并。

以下早前独立本owner闭环结论仅对应其标注head。Superseded by 本节最终拆分事实（2026-10-30）。

完成 Delivery 按 binding/repository/key/workItem 的读取隔离、offline许可值/stale、新owner读健康延续、Storage ack 后恢复、Host返回和metadata版本复验，以及已开详情token失效。仍由Core同一runtime owner控制，持久证据沿现SyncCursor健康scope，无新权限数据库或第二操作ledger。

独立完整评审在旧a6477f2发现2P1+1P2，普通Core/Host反例5红与既定117绿分开记录；修复head `f43efcde3b7c06cefebd2d10c06d758ffe456b85` 限定复评原反例6/6、新健康状态2/2、相关197/197、typecheck通过，无新增阻塞。真实close/reopen、跨owner/target、redaction和恢复事务失败、marker写失败、metadata ABA、phantomowned等已纳入正式测试。

在 `fix/delivery-runtime-access`（base A `d9b669e5c3b2f29b185df8b8ae71ec2391670c10`）最终 `pnpm verify` 为2688+7、关键34、扩大137通过；八类隔离副本负控击中对应内容断言。源码head的15项hosted checks全部成功，base/双向closing#468/空分页线程已回读。实际非docs A+D=738；归档文档按最终对象重新累计必须<1300。

本次归档仅改文档；最终push后仍重新读取该head的checks/issue/全部threads再设置ready，不沿用旧head。外部actor=SingularityKChen，目标GitHub repository/project10，幂等键`2026-10-30:468:delivery`；维护同一PR469和字段，未写规划Status或原生依赖。

这证明本地生产Host链路与hosted验证，不替代真实账号/已安装Host UAT或R1；父#457继续开放，逐步门和唯一production browser总矩阵由C验收。回滚本PR保留A，不删除数据或外部资源。

### Artifacts and Notes

原始日志和负控在任务运行态；本计划保存检出/命令/真实结果与边界。

## Bottom Change Note

- 2026-10-30（Asia/Singapore）：初版；从原超预算 B 收敛完整 Delivery 读侧，保留目标/key隔离、真实 Host/client 和已开详情安全，逐步写门/browser 由独立 C 完成。

Change Note (2026-10-30 SGT)：协调者创建并回读父 #457 的 Delivery 子 issue #468，固定当前 A 实际 API；A 独立审查发现正在其工作树修复，Delivery 仅修改自身区域，最终须重放 A 修复并跑全部组合验证。外部 actor=SingularityKChen，目标 GitHub repository/project10，幂等键=2026-10-30:457:delivery-child，结果为子 issue 与父子关系成功，未写 Status 或 blocked-by。

Change Note (2026-10-30 SGT)：实施发现 collectBindings 丢失静态拒读的层来源，文件集有界增加 registry.ts，只为 unavailable effective capability 保留固定 permission/policy/capability reason；不带 Provider 原文、不增加 authority。当前非 docs 预算仍小于 799，先加层归因判别测试再实现。

Change Note (2026-10-30 SGT)：首轮完整 verify 报 24 个失败（含子测试）：详情精确白名单 2、controller gap 1、AC297 missing-reference/gate-denial/partial 两 Storage 16、Host credential catalog 父子 3、hand-built shared-binding context 2。增加上述既有测试的精确断言/真实 runtime owner 接线到写集；静态路由或 policy 缺口只查询遮罩，只有明确 permission 拒读清空当前快照，保持原有关系和无关存储事实。

Change Note (2026-10-30 SGT)：完成 B 本地实现、内容 canary 与晚到请求红绿、目标/挂载/history scope 隔离、静态归因与提交末尾 epoch 判别；如实记录首次 full verify 的 24 失败与第二轮全绿。查询只做 epoch 复验而不持 publication 队列，避免已有“snapshot 与 relations 间刷新”用例中的嵌套等待；提交仍用 owner.local 串行。计划保持 Active 等待 A 重放、独立 review 和远端回读。

Change Note (2026-10-30 SGT)：基于已建立的 `backup/delivery-before-planning-rebase-20261030` 重放至最终 A `d9b669e5c3b2f29b185df8b8ae71ec2391670c10`；唯一冲突在 Host runtime 测试，完整保留 A claim/first-write/intent-commit/ignored-old-error 与 B late success/reject。`context.ts`、`start-work.ts`、`bootstrap.ts`、`git-provisioning.ts` 相对 A 无 diff；`queries.ts` 保留 epochRead/consistentRead/getPlanningSync，固定 PermissionDenied 路径未改。重放后 B/Host 关键 63/63、A 与 admission/external-intent/step/request 关键 156/156、execution refresh 与 Start Work E2E 50/50 通过；新父 source 副本负控 query 10/14 红、epoch 2/14 红。计划仍 Active，待新独立对抗评审及远端回读。

Change Note (2026-10-30 SGT)：新父基线下 `pnpm verify` 成功，typecheck、主测试 2676/2676、MVP 7/7 全绿，无新增失败。最终检查使用 `node scripts/rule-checks.mjs disclosure fix/planning-runtime-access`、`size fix/planning-runtime-access`、`git diff --check fix/planning-runtime-access...HEAD`；代码/测试 A+D 保持 389，文档按本次提交后的实测回读。没有 push、ready、merge 或 Status 写入。

Change Note (2026-10-30 SGT)：独立完整评审发现 F1 新 owner 重新外发历史/failed-redaction CI、F2 Host 最后 scopeGuard await 窗口返回旧投影、F3 metadata 只围 Planning epoch。先纳入两 Core/三 Host 普通状态探针 RED，再集中修复。扩展上述最小写集；SyncCursor 承载按 binding/key/repository 的读健康版本、拒读与 scope 复验证据，不加权限库或 migration。Provider 调用前持久 in-flight 标记，结果失败不能使新 owner 借 descriptor 恢复；普通 offline 清标记并保留许可 stale cache。查询每次读健康事实且零写，Host 最后异步检查之后同步比较同 authority 版本，metadata 双版本围栏；每目标 token 含不可 ABA 访问版本。预算预测约650–720非docs，最终必须<799。

Change Note (2026-10-30 SGT)：首次持久 read-health full verify 2682 中 12 红：两个离线保留重启、唯一写者旧单事务断言、四类提交失败注入/乱序、两个跨 owner 普通离线与 AC367 两 Storage。调整不完整读只清健康 marker、不恢复 scope；未知在途健康用 capability 缺口，不能冒充明确 permission 并清事实。故障注入定向事实事务读写，避免读前健康短事务提前消耗一次性 fault；AC367 在事实已读取后再注入外部身份竞争。

Change Note (2026-10-30 SGT)：集中修复 F1/F2/F3 后关键两文件 33/33、含 AC367/既有 Delivery 的组合 137/137 通过；第二轮 full verify typecheck+2687/2687+MVP7/7 全绿。新增真实 close/reopen、已经存在的另一 owner 看到持久拒读、offline 授权 cache 重组、marker 起点写失败零 Provider、健康观察落盘失败、新 owner 同 scope 恢复及事务 ack 前后失败矩阵。memory/SQLite 均先故障 redaction 留旧事实，再拒绝恢复事实/健康事务 commit，确认旧节点仍不可见；begin 只在 ack 后增加 owned，scope 健康只在 ack 后安装。初次 ACK 负控因提前版本与 guard 的组合未命中目标窗口，改为同时提前 ticket.version 与 install 后，两条内容断言均红且无超时；最终源码仍绿。全部运行态证据保留 `.superpowers/delivery-access-evidence/review-*`，不提交日志。

Change Note (2026-10-30 SGT)：最终新增 phantom-owned 判别：读前健康事务 callback 正常执行后 rollback，随后另一 owner 正常开始未完成读，本 owner 不能用虚假的 owned 计数放行旧 CI；隔离副本把 owned 增量提前到 ack 前后，该条内容断言红。最终核心+生产 Host 两文件 34/34，全 B 非 docs A+D=738；所有 scope/source 解码与 owned 改变均受 Delivery epoch 复验。独立副本负控结果：query 13/21 红、current epoch 1/21 红、去持久化 3/21 红、metadata 单 epoch 1/21 红、Host final fence 1/1 红、去 accessVersion 1/1 红、scope 提前安装 2/2 红、owned 提前 1/1 红；均保护内容/访问状态，最终 ACK/owned 负控无取消或超时。计划继续 Active，待限定复评、最终发布面/远端回读，不宣称完成 #457 或 #468 人类验收。

Change Note (2026-10-30 SGT)：最终冻结源码 `pnpm verify`：typecheck、主测试 2688/2688、MVP7/7 全绿，workflow 8 文件无 findings，diff whitespace 检查通过。人工五类目检查没有真实凭据、本机身份/路径、个人信息、内部系统或保密内容。最终 amend 后以 base `fix/planning-runtime-access` @ `d9b669e5c3b2f29b185df8b8ae71ec2391670c10` 回读规模及 disclosure。

Change Note (2026-10-30 12:47 SGT)：记录两P1与P2的持久健康/版本/Host出站修复、限定复评和源码head hosted结果，归档完整Delivery读闭环。

Change Note (2026-10-30 SGT)：因独立复审新P1重开所属计划，移回active；先前完成/Ready仅是当时head观察，不能替代本次修复验收。

Change Note (2026-10-30 SGT)：明确独立跨owner P1及#481必要依赖；原闭环断言只针对标注旧head，不再以本owner gate替代共享authority。规划Status和原生依赖未写。

Change Note (2026-10-30 SGT)：同一source authority的跨owner上层独立验收通过后归档；明确本层738行与#481新增完整返回保证，不将旧本owner测试充当跨owner接受。
