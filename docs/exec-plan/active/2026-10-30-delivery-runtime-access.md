# Delivery 运行时读访问隔离 ExecPlan

> 状态：Active；创建：2026-10-30（Asia/Singapore）。
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

### 结构化失败与唯一访问判断

内部 CapabilityGap 增安全 ProjectErrorCode，保留 key 与实际服务 binding；Provider 原始 message 不进入 wire。DeliveryRefreshGap 可以带闭集 code，但只使用固定 key/layer/retry 说明。通过同一个 runtime owner 观察操作结果；当前 shipped 读范围是 DevelopmentRepositoryRead、DevelopmentChangeRequestRead、DeliveryPipelineRead、DeliveryCheckRead。

target 明确取已选择的 repositoryId，不按 provider 名猜。仓库局部拒绝不能污染另一个仓库；不同 binding/key 不能互相解除。Planning 的单一 scope 无需预先泛化，实现本切片时给 owner 增有界 target 参数即可。既有 workspace capability 描述仍表示挂载声明，目标的有效门复用 `repositories[].capabilities`，不新增第二份权限事实。

显式 refreshDeliveryFacts 对 runtime denied 的已实现 key 可做真实只读重新验证，但不能绕过 capability 缺失或 policy 禁止。成功仅清除同 binding/key/target、在 denial 后开始且完整读完的观察；静态 describe、另一 key 或另一 target 的成功均无效。

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

文件集：`packages/core/src/runtime-access.ts`（仅目标扩展）、`packages/core/src/chain-facts.ts`、`packages/core/src/delivery-facts.ts`、`packages/core/src/delivery.ts`、`packages/core/src/queries.ts`（repository capability metadata）；`packages/client/src/delivery-lineage-reader.ts`；`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui-model/src/delivery-lineage.ts`；`packages/ui/src/work-item-detail.ts`、`packages/ui/src/delivery-lineage-section.ts`；新 `tests/integration/runtime-delivery-access.test.js`、既有 `tests/integration/harness-plugin-runtime-access.test.js`；必要既有 `tests/e2e/delivery-lineage.test.js`、`tests/e2e/delivery-lineage-strip.test.js`、`tests/integration/harness-plugin-delivery-lineage.test.js` 精确断言；本计划与 `docs/README.md`。不修改 Start Work provision 或 browser carrier。

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

- [x] 2026-10-30（Asia/Singapore）：独立检查读链、唯一写者、投影与局部 UI 缓存，建立本计划。
- [ ] 确认 A 的实际合入接口/base，落盘 repository active plan 和 docs 索引。
- [ ] Batch 1：红测试和实际预算。
- [ ] Batch 2：读侧权威状态及持久化矩阵。
- [ ] Batch 3：生产组合/局部 cache/负控。
- [ ] Batch 4：独立 PR 验证、严格规模与远端回读。

## Surprises & Discoveries

`CapabilityGap` 原来只有 reason，无法区分离线与拒权；`DeliveryRefreshGap` 只有 key 是有意的安全边界，结构码扩展仍需坚持不转发 Provider 原文。`readDeliveryProjection` 原有 unavailable 标志并没有移除 label/externalId/fact，故不能只测试 flag。

Storage 只有按 context 获取/写 DeliveryFacts，无全库枚举 API；本切片不为全库批量清理加 migration。当前触达 scope 的 redaction 落库，其余历史 scope 由同 owner 的目标 mask 在权威 query 过滤；成功恢复只能针对同 scope/key 新读，不能使别处旧事实复活。

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

Node ≥22、pnpm、fake/SQLite 与生产 Host typed remote，无真实凭据或上游外部写。A 必须先提供 current binding/key access 与 epoch；B 只加 repository target 和读结果观察，不改变其 Planning 语义。C 会在 B 上 stack，使用同一 owner 和目标 metadata。

后续实际浏览器沿唯一 `tests/fixtures/execution-drawer-browser.mjs` 改造，B 不需要它先存在。#204 拥有 provision/execution，B 不修改该文件域；最终组合回读验证前端快照顺序，不能绕开 redaction 的职责。

Delivery 之外的 C 验收是同 issue 尚未完成的范围，不是本 PR 可接受的安全债务。若实现确实接受延期，按仓库 `docs/exec-plan/tech-debt-tracker.md` 登记，但不得降低本表关闭门。

## Outcomes & Retrospective

当前为独立评审后的可执行候选，尚无产品 diff、测试成功或规模实测。实施结束记录实际 head/base、矩阵、负控、规模和偏差；B 仅报告 Delivery 读侧闭合，不宣称完整 #457 接受。

### Artifacts and Notes

临时日志和负控保存任务运行态目录；正式证据包含分支、命令和真实结果。

## Bottom Change Note

- 2026-10-30（Asia/Singapore）：初版；从原超预算 B 收敛完整 Delivery 读侧，保留目标/key隔离、真实 Host/client 和已开详情安全，逐步写门/browser 由独立 C 完成。

Change Note (2026-10-30 SGT)：协调者创建并回读父 #457 的 Delivery 子 issue #468，固定当前 A 实际 API；A 独立审查发现正在其工作树修复，Delivery 仅修改自身区域，最终须重放 A 修复并跑全部组合验证。外部 actor=SingularityKChen，目标 GitHub repository/project10，幂等键=2026-10-30:457:delivery-child，结果为子 issue 与父子关系成功，未写 Status 或 blocked-by。
