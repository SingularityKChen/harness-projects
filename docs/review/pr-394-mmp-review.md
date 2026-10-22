# PR #394 MMP 交付评审

- 日期：2026-10-22。
- 锁定 head：`09f33c38e1eaddbf997f2bafd7dad4131370f33a`。
- 锁定 base：`main` / `d7e7bca6aae31a4329f3238d3b90274dd683516c`。
- 实现会话：`规划紧急重要的并行Issue`；保留原分支 worktree。
- 评审账号：`Singularity-AI-Bot`；开发、作者回复与合并账号：`SingularityKChen`。
- 方法：Superpowers 独立评审、Qian 系统综合、First Principles 不变量与反例。

## 锁定事实

- 初审对象为 `main...09f33c38e1eaddbf997f2bafd7dad4131370f33a`，不是临时集成树。工作树为 `.worktrees/host-planning-refresh`；开始与变异结束后均核对 head 和工作区，产品文件无未提交变更。
- PR 为 OPEN、非 draft、MERGEABLE；当前 `mergeStateStatus` 为 UNSTABLE。三条提交依次是计划 `5cb430cac831`、实现 `2caa1842f76a`、归档 `09f33c38e1ea`，均以 `Refs #335` 关联；PR 的 `closingIssuesReferences` 是 #335。
- 初审前该 head 的 review、inline comments、GraphQL reviewThreads 均为空，reviewThreads 无下一页。不存在遗漏的待处理线程。
- 当前 head 的 PR Fast Gate、Verify、Merge Gate 及 Integration/E2E/MVP-0/Boundaries 四 lane、CodeQL、Issue policy、size、disclosure 均为 success。
- 非成功项为可选 `Create review session`（run `39709397983`）失败、`Reconcile engineering state`（run `39709397974`）取消。前者的失败日志已回读：loopback 评审端点无法连接，curl 7、响应 000000，#364 精确追踪；后者属于全局工程状态自动化；后继 run `39709409047` 成功，日志明确执行 `Reconcile Engineering across the whole Project`，覆盖此前取消轮次。两者不替代产品验证。

## 风险矩阵（逐文件审查前建立，完成后回填）

| 级别 | 待核对风险 | 层 | 当前结论 |
|---|---|---|---|
| P0 | 关库后写入、跨 workspace 或凭据泄露 | 代码、产品闭环、架构、测试、反例、issue 验收 | 已审查；未发现新增 P0 |
| P1 | 刷新不启动、重叠、超时失控、卸载不排空或恢复失败 | 代码、产品闭环、架构、测试、反例、issue 验收 | 已审查；未发现新增 P1 |
| P2 | 刷新时效、可观测性与受控晚值 | 代码、产品闭环、架构、测试、反例、issue 验收 | C394-1：scheduler 诊断接线的 Host 测试不能判别断线变异；实现本身接线正确 |
| P3 | 命名与证据可读性 | 代码、产品闭环、架构、测试、反例、issue 验收 | 已审查；无独立建议 |

## 证据与逐层结论

### 代码和生命周期

`host-composition.ts:99–108` 在初次 Core 组合后才启动一个 scheduler；空工作区或没有有效 Planning 槽时不启动。interval 默认和下限均是 60000ms，上限采用 Node timer 范围；Core scheduler 没有被重写。

`host-operations.ts:81` 的 actor-only `refreshPlanning` 经 HANDLERS 进入既有 Controller/Core 命令，没有 replay key。scheduler 也进入同一 `core.commands.refreshPlanning()`。定时、显式多次请求停在同一实际 list 等待时只发生一次读取，结束后下一显式请求真实重读。

`host-planning-lifetime.ts` 包装六个 Promise 读与 reconcile 迭代。预算在 Core 正在等待的端口上拒绝，迭代的 deadline 不随 next 续期；iterator return 不合作时只消费结果，不让 Core 的 IteratorClose 再挂住。原 Provider 方法的 this、definition、可选方法缺席与写确认保持。生产 credential/fetch/json 挂起与 fake list/iterator 挂起均观察到预算内失败，随后成功轮恢复；晚值不推进旧投影，晚拒绝被消费。

`host.ts:52–59` 先 stop，再 remote drain，再 composition drain/close。stop 同步封闭 call/watch 和 Provider 新读准入，回收 timer；已登记轮次仍可完成既有 Storage 收尾，close 在 pending settled 之后发生且只发生一次。迟到凭据在 stop 后不能启动 fetch。测试覆盖 double dispose、保留 callback、remote 注册失败、effect 注册失败及首轮 describe 超时。

### 产品闭环

核查路径是 Host apply → 生产 GitHub Planning Provider → 鉴权回放 transport → SQLite/Core → typed remote baseline/watch。新增测试覆盖无事件刷新、无命令的晚凭据恢复、失败保留 last-known 与原确认时刻、恢复后 fresh，以及 Provider 写调用为零。

独立补充探针将生产 Provider 与已打开的 remote watch 放进同一条链：初始凭据缺席时 watch baseline 为 0 行；凭据出现后仅触发 scheduler，原 watch 收到 delta，baseline 是 9 条 fresh 实体；再次修改回放响应的 title 并触发 scheduler，原 watch 与 baseline 都含 `Updated by scheduled read:`。累计 7 次回放请求，misses 为零。没有用 explicit refresh 帮助恢复。

独立 iterator 探针在绝对预算到期后 resolve 旧 next、reject 旧 return，再次 next 得到本地 done：底层 next/return 各 1 次，unhandledRejection 为 0。与“在整个 Core 命令外层 race，但内部仍能提交”的错误方案有可观察区别。

### 架构和安全

Host 只拥有调度与读等待资源，不新增 Planning 事实源或业务 single-flight 缓存。Core 继续拥有轮次 fence、Storage 提交和业务修订；client/UI 只消费快照。未引入反向依赖或 Provider 互调，包边界 9 项通过。刷新不经过 Provider 写口，不改变 Planning/Engineering 正交关系，不产生未确认 Saved。

凭据仍通过 Host secret handle 每次解析，未进入 Project 数据库；日志只记录既有 name/code/errcode 白名单，新增测试验证 canary message 与路径不进入日志。审查 diff、提交信息和 PR 正文的凭据、本机身份、个人信息、内部系统、保密字样五类目，未发现新增发布面泄露。机械扫描不含本次未提交评审文档，文档另做路径检查。

### 验证证据

在本节锁定 head 的工作树根目录执行：

```sh
node --test --test-timeout=120000 tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-watch.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-artifact.test.js
pnpm run typecheck
pnpm run boundaries
node scripts/rule-checks.mjs disclosure d7e7bca6aae31a4329f3238d3b90274dd683516c
node scripts/rule-checks.mjs size d7e7bca6aae31a4329f3238d3b90274dd683516c
git diff --check d7e7bca6aae31a4329f3238d3b90274dd683516c...HEAD
```

结果：目标 75/75、typecheck exit 0、boundaries 9/9、disclosure/size/diff-check exit 0；变更代码和测试 465 行、文档 168 行。没有重复运行全仓 verify；完整 CI 结果来自当前 immutable head，不能借用 ExecPlan 中历史实现 head 的绿灯。

补充探针位于本次临时评审目录，用 `PR394_ROOT="$PWD" node --test --test-timeout=10000 "$REVIEW_TMP/pr394-probes.mjs"` 执行，2/2 通过；结果和触发步骤见上节。临时探针不加入被评审产品树。

### 变异表

使用 `node scripts/review-mutate.mjs "$REVIEW_TMP/pr394-mutations.json"`，command 为 `node --test --test-timeout=10000 tests/integration/harness-plugin-host-planning-refresh.test.js`。四项在最终产品树一次整表执行；夹具先跑基线，每项后按原字节还原，末尾再跑恢复后的基线。整体 exit 1 仅因 M4 存活，非夹具错误；结束后产品文件 `git diff` 为空。

所有变异文件都是 `apps/harness-plugin/src/host-composition.ts`。以下唯一锚点及 replacement 可直接构造脚本 spec，killedBy 均显式指定：

| ID | anchor → replacement | killedBy | 结果 |
|---|---|---|---|
| M1 | `reconciler.start()` → 注释，省略启动 | `scheduled refresh updates baseline` | KILLED，定时更新入口断言变红 |
| M2 | `await Promise.allSettled([...pending])` → 注释，省略排空 | `stop closes admission synchronously` | KILLED，SQLite 过早 close 的断言变红 |
| M3 | `closed = true; lifetime.stop(); reconciler?.dispose()` → `closed = true; reconciler?.dispose()` | `production credential, fetch and response.json` | KILLED，迟到凭据在 stop 后发起 fetch 的断言变红 |
| M4 | `intervalMs, diagnostics, ...(options.planningTimers` → `intervalMs, ...(options.planningTimers` | `scheduled double faults reach the actual safe diagnostics sink` | SURVIVED，新增集成 10/10 仍绿 |

### 工作项和已有追踪

逐条核对 #335 正文九条验收及两条评论。实现、目标测试与补充生产 watch 探针支持 scheduler 数量/生命周期、无事件读取、stale 保留、显式共享 flight、诊断接线、有界读和速率下限；当前 head 发布 gates 与安装件测试成立。九个 issue checkbox 当前仍未勾选，由 owner 按仓库收尾流程更新；本评审未写 issue/Project 状态。

已读取相关开放 issue，避免把前置或延期能力重复计入本 PR：#338 是通用 Host abort/bounded unload 与 actor/data-root；#354 是挂载变更后重组；#360 是页面刷新控件；#361 是原子 snapshot 与确认时刻；#336 是 Core/scheduler absorber 与边界测试；#143 是人类真实安装纵向验收。没有将这些未完成工作宣称为本 PR 已闭环。

ExecPlan 已归档于 `docs/exec-plan/completed/2026-10-22-host-planning-refresh.md`，索引同步，明确真实 Desktop 验收边界和与 #395 的机械冲突整合要求。回滚单位为本 PR 的能力提交，不涉及 schema/data 迁移；临时多分支集成结果不是本次独立评审的替代证据。

## 候选意见

### C394-1 · P2 · 让 Host 诊断测试区分 Core 与 scheduler 的上报

- 精确新增行：`tests/integration/harness-plugin-host-planning-refresh.test.js:254–256`，建议 inline 锚定 255。
- 触发与缺陷：当前用例让 SQLite transaction 抛错，Core 的 `reportSyncRoundFailure` 已先写入 `syncRoundFailed`；断言只检查文件含有任意匹配行，无法判断 scheduler 是否收到同一 sink。
- 影响：删掉 `host-composition.ts:106` 的 `diagnostics` 传参后，#335 明确要求的 Host scheduler 诊断接线退化，但 10 项新增集成全部通过。当前实现确实传入同一对象，因此这是非阻塞测试缺口，不是当前运行时故障。
- 复现：执行上表 M4，结果 `GREEN exit=0 failing=[]`、`SURVIVED`；完整表 exit 1，恢复检查通过。
- 修复方向：断言 Core 与 scheduler 两个已定义上报来源都被观察，或制造只由 scheduler 报告的失败并断言真实 log，再固定“删除 scheduler diagnostics 传参必须 RED”的变异。
- 已有追踪：#335 有明确 diagnostics 接线验收，本项在当前 PR 内补齐。#336 聚焦 Core absorber/thenable/post-stop，正文明确排除 Host wiring，不能替代本项；无需重复新建 issue。

## 未验证边界

- 没有安装到真实 Desktop、使用真实 token 或访问真实 GitHub Project；本次证据止于真实生产 Provider、鉴权回放、真实 SQLite 和 Host remote/watch。
- JavaScript 不会硬杀底层不合作 Promise；本实现保证 Core 等待结束、晚值不提交，并在 stop 后阻止新凭据/fetch 准入。没有把底层操作硬取消或通用 Provider abort 当成本 PR 已具备的能力，后者已有 #338。
- 暴露给测试的原始 `controller` 不属于 typed remote 调用的 drain 登记面；所有生产入口通过 call/watch。没有将内部直接调用的任意时序扩大为公开 Host 卸载保证。
- 可选自动评审失败已核对；工程状态自动化取消已由后继全域重算 `39709409047` 覆盖，不据此改写本 PR 产品测试结论。

## 结论与后续

建议 **APPROVE**。完整矩阵未发现新增 P0/P1；C394-1 为有变异证据的 P2 测试建议。独立交付能力是 Host 定时/显式 Planning 刷新及其有界等待与卸载生命周期，不代表整项 M4 人类验收通过。

本评审只写此文件，未修改实现、提交、push、发送 GitHub review 或合并。发布 review 前协调者仍须重新锁定 head/base；任何 head、base 或产品树变化都需要重新核对受影响证据。

## C394-1 修复与复评

初审 review `5608666017` 以 APPROVE 一次提交全部意见（1 项 P2，0 项 P0/P1）。根因是 Core 与 scheduler 共享 sink，原存在性断言无法区分两条已定义的上报路径。
修复仅在原真实 Host/SQLite 双故障测试中解析日志，过滤该 StorageFault 后断言恰好两条：Core 轮内报告一次，scheduler 对拒绝的 tick 再报告一次；两次上报由 `PlanningReconcilerOptions.diagnostics` 的契约明确规定。保留脱敏与后续刷新恢复断言，不改生产代码或扩大 #336。

修复后目标 10/10 通过；使用同一 spec 在最终修复树整表重跑，M1/M2/M3/M4 全部 KILLED，M4 的失败用例精确为 `scheduled double faults reach the actual safe diagnostics sink and subsequent ticks continue`，还原后基线通过、原文字节恢复。上表 SURVIVED 只记录初审状态，修复后的状态以本段为准。
独立复评 APPROVE：分别断开 Core sink 与 scheduler sink 两项反例均 KILLED，由原诊断用例精确归因；临时日志只含本轮故障，Promise 微任务完成后两条日志已同步写入。最终 push 后仍须回读 exact-head checks/review threads，旧 head 的批准不转移给新 head。

最终整合：#393、#392 已按队列合并，本 PR 变基至真实 `main@d6840e0f9656797bdbf5fffca4f6dcd89881b6ac`。Host 生产实现与初审逐字相同；相对初审唯一测试修订为 C394-1 的三行诊断断言。已继承的仓库路由和测试执行优化不改变 Host 的状态所有权，最终 head 仍须重新独立复核及回读 checks/threads。
