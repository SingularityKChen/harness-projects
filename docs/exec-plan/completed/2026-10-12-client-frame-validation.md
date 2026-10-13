# Client Frame Ordering 与 Capability Identity ExecPlan

> 状态：Completed
> 创建：2026-10-12
> 范围：完成 issue #312；在已完成 #308 browser-safe client leaf 之后，修复 client 运行时 frame ordering、capability identity 唯一性和拒绝原子性。
> 上游输入：AGENTS.md、PLANS.md、issue #312、#218、#276、PR #323。

## Purpose / Big Picture

client 接受点必须拒绝旧/倒退 revision、重复或未知 capability identity，以及任何会让 denied 内容变 current 的 malformed frame。拒绝必须是原子的：rows、workspace header、current/stale flags 和 lastUpdatedAt 都保持之前状态。合法新 generation reset 由 #218 的 generation contract 明确允许，本 PR 不重新定义 generation。

## Context and Orientation

当前接受路径位于 packages/client/src/sync.ts、store.ts、workspace-read.ts；#308 已将 runtime wire values 从 Controller Host root 中隔离。#312 与 #308 共享这些 client 文件，但接受点、失败模式和回滚边界不同，因此保持独立 PR；本分支以 #308 为 stacked base，仍使用 Closes #312，不重复关闭 #308。

## Design / Spec

- 对 delta：要求 previousRevision === local revision、revision > previousRevision；旧/不前进帧 fail closed。
- 对 baseline/generation reset：保留 #218 授权的新 generation reset 入口；没有 generation evidence 的低 revision baseline 不得静默覆盖。
- 对 capability entries：key 必须是已知 capability，数组中 key 唯一；重复冲突 access、未知 key、坏 access 一律拒绝。
- 对 header/store：先完成全部 shape/order/identity 校验，再调用任何 apply；拒绝时不修改 store/header/connection/time。
- 对 gap/reconnect：gap 仍先标 stale，再以合法新 baseline 恢复；malformed frame 不得伪装成 gap recovery。

放弃：在 client 端 last-wins；把 revision reset 归因于数值大小而没有 generation；把拒绝拆成多个部分写；与 #308 合并为 client PR。

## Global Constraints

- 只修改 client acceptance paths、wire validation tests、ExecPlan；不修改 Core/Storage/Provider、#218 generation owner 或 #308 leaf semantics。
- 代码≤800 行、文档≤1300 行；分支 fix/client-frame-validation，base 为 fix/client-browser-wire，PR 使用 Closes #312。
- TDD：先写旧实现可通过的现有反例，新增 delta 1→0/duplicate capability/unknown key/post-reject snapshot 反例，再最小实现。
- 保持浏览器 contract #308 绿；不引入 Node shim/external。

## Plan of Work

### Batch 1 · 方案与 stacked draft

最小闭环：在 #308 之后暴露 frame validation 设计和红灯测试，保持独立 issue/PR。

- [x] 读取 #218 generation contract 与当前 frame acceptance；#218 明确要求 generation 与 revision 一起排序，并允许新 generation 的低 revision reset，但没有规定当前 wire 字段名。
- [x] 新增倒退 revision、duplicate capability、unknown capability、坏 access、post-reject state snapshot 反例；旧实现红证据：初始 head `2700e0846` 的 `node --test tests/e2e/workspace-read-assembly.test.js --test-name-pattern='倒退|低 revision'` 对倒退 delta 与低 revision baseline 均报告 `Missing expected rejection`；adversarial 新增的 generation 缺失与前游标超前用例在旧 `sync.ts` 上再现 4 failures（均为 `Missing expected rejection` 或缺少预期 recovery）。
- [x] 创建 stacked PR #326，native issue links、labels、milestone 回读（2026-10-13）。

### Batch 2 · 原子 frame validation

- [x] 把完整 validation 置于 apply 前：`assertHeader` 校验已知且唯一 capability key、四态 access、坏字段；delta 校验 `previousRevision === local revision` 且 `revision > previousRevision`。
- [x] 让拒绝保持 rows/header/current/stale/time 不变；帧拒绝使用专用错误，不触发 `lose()`。重连开始时预先标 stale 属连接状态转换，拒绝基线不会再改变该快照。
- [x] 保留合法 generation reset、gap/reconnect 和 existing client behavior；generation evidence 采用可选的非负整数 `generation` 字段建立连接代际，但一旦本地代际已建立，baseline/delta/metadata 均必须携带同代证据；仅 baseline 允许严格递增 generation 跨低 revision reset。
- [x] 恢复合法缺口判定：`previousRevision > local revision` 且 `revision > previousRevision` 走 `recover()`；`previousRevision < local` 或 `revision <= previousRevision` 仍 fail closed 且拒绝原子。
- [x] gap 分流前复用 `store.assertDeltaFrame()` 完整校验 delta revision/source、row source、removed 数组和 upsert entity id 唯一性；malformed delta 不再伪装成 gap recovery。

### Batch 3 · 对抗验收与 ready

运行 client browser #308 contract、frame/client e2e、boundaries、workflow、size、disclosure、diff-check；独立 current-head review 通过后置 ready。

### Batch 4 · 评审响应与畸形 event 原子拒绝

**最小闭环**：transport 返回缺失或错误嵌套载体时，在读取字段前归类为帧拒绝，保持已确认快照不变。

- [x] 先加入 `metadata.entities=null` 与 `delta=null` 的真实 `sync.poll()` 反例，并在旧实现上确认会误触发 `lose()`。
- [x] 在 client 接受点前增加 event shape guard，避免普通 TypeError 进入连接失败路径。
- [x] 复跑 client/browser focused suite、typecheck 和 package boundaries。

**验证**：

```sh
node --test tests/e2e/workspace-read-assembly.test.js --test-name-pattern='畸形 event'
node --test tests/e2e/workspace-read-assembly.test.js tests/e2e/client-sync.test.js tests/contract/client-browser.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-work-item-detail-browser.test.js
node_modules/.bin/tsc --noEmit
pnpm run boundaries
```

期望：畸形 event 被拒绝，`rows/header/current/stale/time` 深相等；focused suite、typecheck 和 boundaries 全绿。

**回滚**：反向提交 event shape guard 与对应反例；不改 generation producer、Host transport 或 schema。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 倒退 delta 被拒绝 | rev 1→0 不改变 store/header/time |
| 2 | capability identity 唯一 | duplicate/unknown/坏 access fail closed |
| 3 | 拒绝原子性 | post-reject snapshot 深相等，current/stale/time 不变 |
| 4 | 合法 generation reset | #218 授权 reset 仍可完成 |
| 5 | gap/reconnect 回归 | 前游标超前 delta 进入 gap，stale 窗口与合法 baseline recovery 全绿 |
| 6 | #308 stacked regression | browser bundle external=[]、无 Host inputs |
| 7 | 规模与公开面 | size≤800/1300、checks、native links 回读 |
| 8 | 畸形 event 原子拒绝 | `metadata.entities=null` / `delta=null` 在统一拒绝前不改变连接、行 stale 或当前性 |

## Progress

- [x] 读取 current #312、#218、#276 与 #308 current head。
- [x] 完成新 issue 组合中的独立系统/交付/反方排序；确定 #308→#312 stacked、独立 PR。
- [x] 创建 stacked worktree，base #308 head f2308fd1。
- [x] Batch 1 红灯与 draft PR（2026-10-12）。
- [x] Batch 2 实现（2026-10-12）。
- [x] Batch 3 复评与 ready（2026-10-13：独立 MMP 评审；P0/P1=0，P2=1）。
- [x] Batch 4 评审响应与 event shape guard（2026-10-13）。

## Surprises & Discoveries

- 2026-10-12：#308 的现有 browser contract 已覆盖真实 client factory；#312 可以复用但不能把 frame semantics 归入 #308。
- 2026-10-12：revision reset 不能凭数值大小判断，generation owner 属于 #218。
- 2026-10-12：#218 issue body 与评论只定义 generation 是跨 baseline/delta 的排序证据及新 generation reset 的合法性，未定义当前 controller wire 字段；本批消费可选 `generation` evidence，不猜测或改动 #218 owner。来源：`gh issue view 218 -R SingularityKChen/harness-projects --json body,comments`；业界对照为 RFC 1982（DNS serial arithmetic 要求显式序列关系，单凭普通数值不推断回绕）与 Kubernetes API Concepts（`resourceVersion` 用于 list/watch 一致快照与续传）。
- 2026-10-12：独立复评复现了 disconnect/reconnect 期间迟到 baseline/delta 仍可能重新发布 `connected=true` 的异步 fencing 缺口；该行为属于 #218 的连接操作代际 owner，本 PR 不修改 transport 或 generation owner，作为后续依赖转移记录，不作为 #312 已交付能力。

## Decision Log

- 2026-10-12：#312 stacked 在 #308 之后，但保持 Closes #312 独立 issue；理由是依赖图修复与 runtime protocol acceptance 是两个可回滚闭环。
- 2026-10-12：拒绝采用 last-wins capability lookup；原因是 malformed/duplicate entries 不能授权。
- 2026-10-12：不改 #218 generation semantics，只消费其授权 reset 证据。
- 2026-10-12：采用“先全量校验、后一次 apply”的原子接受点；拒绝帧不调用 `lose()`，避免 malformed 内容误报成断线/缺口；gap 仅保留给 transport 明示的缺口。
- 2026-10-12：adversarial review 后收紧代际边界：一旦建立 generation，任何 baseline/delta/metadata 缺省 generation 都拒绝；否则无法证明跨 baseline/delta 的排序证据。来源为 #218 generation contract 的“generation 与 revision 一起排序”要求。
- 2026-10-12：adversarial review 后恢复 delta 缺口分支：`previousRevision > local revision` 且 delta 自身严格前进是丢帧信号，必须标 stale 并重拉 baseline；只有倒退 previousRevision 或不前进 revision 才是 malformed reject。
- 2026-10-12：adversarial review 后要求 gap 分支先做完整 delta shape validation；将既有 `store.assertFrame` 提升为 `assertDeltaFrame` 纯校验并由 apply 与 recover 共用，避免 duplicate upserts、`removed:null` 或坏 row source 触发 `onGap`。
- 2026-10-12：generation 正式字段与 producer 由 #218 定义；本 PR 只在 client 接受点消费可选 evidence，并在 evidence 已建立后拒绝缺省帧。这样保持 fail-closed，同时不把未定义的 wire 字段冒充为 #312 已完成的端到端协议。
- 2026-10-13：独立 MMP 评审复现 `metadata.entities=null` / `delta=null` 在分支判断前抛普通 TypeError，`guarded()` 因而把畸形帧误报为连接失败并标 stale；根因是 event envelope 未在嵌套字段读取前验证。
- 2026-10-13：采用最小 event shape guard；畸形载体统一包装为 `FrameRejectedError`，保持已确认快照不变；正式 generation producer 与迟到异步 fencing仍由 #218 承接。

## Idempotence and Recovery

validation 纯读，可重复执行；apply 只有全部验证成功后发生。回滚为反向提交，不涉及 schema/data migration。若 #308 尚未合并，stack rebase 后保持 PR #312 独立 diff。

## Interfaces and Dependencies

#218 generation contract、#308 @harness-projects/controller/values、client store/sync/workspace-read、Node test/esbuild/browser contract。

## Outcomes & Retrospective

已完成：client acceptance paths 增加严格 delta 顺序、generation evidence 完整性、capability identity/access 运行时校验、event envelope shape guard 和拒绝原子性；gap 分流前复用完整 delta shape 校验；新增倒退、不前进、前游标超前 gap、gap 伪装 duplicate/removed:null、缺 generation、重复、未知、坏 access 以及 `metadata.entities=null` / `delta=null` 反例。当前修复后 focused client/browser suite 34/34、typecheck 和 boundaries 通过；完整 `pnpm verify` 与 GitHub required checks 在最终 head 上待复跑。未完成：#218 的正式 generation wire producer 与 late async fencing；两者均已记录为依赖转移。

当前交付已完成 commit 整合：计划、frame validation、畸形 event 修复和评审证据分别落在可独立审阅的 Conventional Commits；PR #326 已重放到 #323 合并后的 `main`，current head checks 全绿。#218 的 generation producer 与 late async fencing仍由后续 owner 承接。

## Bottom Change Note

- 2026-10-12：创建 #312 stacked plan-only ExecPlan；基于新 issue 三方分析和 #308 current head，选择独立 frame validation 闭环。
- 2026-10-12：Batch 1/2 完成；补入 RFC 1982、Kubernetes resourceVersion 作为定序与一致快照惯例来源，记录 generation 字段证据边界、红绿测试和拒绝与 reconnect stale 转换的语义区分。
- 2026-10-13：根据 MMP 评审的 P2 反例新增 Batch 4；先观察旧实现红灯，再加入 event shape guard 与深相等快照断言。
- 2026-10-13：current-head 修复复评通过，归档本 ExecPlan 并登记 #312 交付；合并前仍需重读新 docs commit 的 checks 与 SHA-bound approval。
