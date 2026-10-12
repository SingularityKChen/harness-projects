# Client Frame Ordering 与 Capability Identity ExecPlan

> 状态：Active
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

- [ ] 读取 #218 generation contract 与当前 frame acceptance。
- [ ] 新增倒退 revision、duplicate capability、unknown capability、post-reject state snapshot 反例。
- [ ] 创建 stacked draft PR #312，native issue links、labels、milestone 回读。

### Batch 2 · 原子 frame validation

- [ ] 把完整 validation 置于 apply 前。
- [ ] 让拒绝保持 rows/header/current/stale/time 不变。
- [ ] 保留合法 generation reset、gap/reconnect 和 existing client behavior。

### Batch 3 · 对抗验收与 ready

运行 client browser #308 contract、frame/client e2e、boundaries、workflow、size、disclosure、diff-check；独立 current-head review 通过后置 ready。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 倒退 delta 被拒绝 | rev 1→0 不改变 store/header/time |
| 2 | capability identity 唯一 | duplicate/unknown/坏 access fail closed |
| 3 | 拒绝原子性 | post-reject snapshot 深相等，current/stale/time 不变 |
| 4 | 合法 generation reset | #218 授权 reset 仍可完成 |
| 5 | gap/reconnect 回归 | stale 窗口和合法 baseline recovery 全绿 |
| 6 | #308 stacked regression | browser bundle external=[]、无 Host inputs |
| 7 | 规模与公开面 | size≤800/1300、checks、native links 回读 |

## Progress

- [x] 读取 current #312、#218、#276 与 #308 current head。
- [x] 完成新 issue 组合中的独立系统/交付/反方排序；确定 #308→#312 stacked、独立 PR。
- [x] 创建 stacked worktree，base #308 head f2308fd1。
- [ ] Batch 1 红灯与 draft PR。
- [ ] Batch 2 实现。
- [ ] Batch 3 复评与 ready。

## Surprises & Discoveries

- 2026-10-12：#308 的现有 browser contract 已覆盖真实 client factory；#312 可以复用但不能把 frame semantics 归入 #308。
- 2026-10-12：revision reset 不能凭数值大小判断，generation owner 属于 #218。

## Decision Log

- 2026-10-12：#312 stacked 在 #308 之后，但保持 Closes #312 独立 issue；理由是依赖图修复与 runtime protocol acceptance 是两个可回滚闭环。
- 2026-10-12：拒绝采用 last-wins capability lookup；原因是 malformed/duplicate entries 不能授权。
- 2026-10-12：不改 #218 generation semantics，只消费其授权 reset 证据。

## Idempotence and Recovery

validation 纯读，可重复执行；apply 只有全部验证成功后发生。回滚为反向提交，不涉及 schema/data migration。若 #308 尚未合并，stack rebase 后保持 PR #312 独立 diff。

## Interfaces and Dependencies

#218 generation contract、#308 @harness-projects/controller/values、client store/sync/workspace-read、Node test/esbuild/browser contract。

## Outcomes & Retrospective

待 Batch 3 完成后填写。

## Bottom Change Note

- 2026-10-12：创建 #312 stacked plan-only ExecPlan；基于新 issue 三方分析和 #308 current head，选择独立 frame validation 闭环。
