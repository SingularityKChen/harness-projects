# Identity 双键冲突一致性 ExecPlan

> 状态：Completed
> 创建：2026-10-12
> 范围：完成 issue #310；让 Fake/SQLite 对 external identity 的 record id 与 natural key 双冲突采用同一 fail-closed 规则。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #310、#190、#201。

## Purpose / Big Picture

当一个写入同时命中一个已有 identity id 和另一个已有 natural key 时，两个 Storage 适配器必须拒绝同一请求并保持两条既有记录逐字段不变。合法 natural-key replay 仍保留已分配 id/entity/binding/kind/externalId，只更新允许变化的 role。

## Context and Orientation

Fake 已经先检查 natural key 与 same id，双冲突拒绝；SQLite 当前只按 natural key UPSERT，导致双冲突把另一条 identity 的 role 改写。生产路径位于 `packages/providers/fake/src/storage.ts` 与 `packages/storage/sqlite/src/storage.ts`，共享契约在 `tests/contract/suites/storage-identity-membership.js`。

#190 仍拥有 exactly-one-primary 的整体模型决策；#310 只关闭 id/natural-key 交叉冲突，不做 id rebinding、删除或模型冻结。#311 的 Fake snapshot alias 是另一条后续闭环，不聚合。

## Design / Spec

### 方案比较

1. **双冲突 fail-closed（采用）**：写入前在同一适配器队列/事务内读取 same id 与 same natural key；若两者是不同记录，返回统一端口错误，不产生任何 mutation。若 natural key 已存在且 incoming id/entity 不同但不命中另一条 id，保留既有 id/entity，只更新 role。
2. **natural-key-wins（放弃）**：把双冲突静默解释为 natural-key replay，忽略 incoming id/entity。它与当前 SQLite 偶合接近，但会把错误 id 当作合法重放并隐藏调用方 bug。
3. **id-authoritative rebinding（放弃）**：重绑或删除 natural-key owner，破坏稳定身份与 #190/#201 边界。

## Global Constraints

- 只修改 identity storage methods、shared identity contract、必要 ExecPlan。
- 不修改 schema、#190 exactly-one-primary 决策、#311 snapshot semantics 或外部 Provider。
- 代码≤800 行、文档≤1300 行；分支 `fix/identity-conflict`；PR 使用 `Closes #310`。
- TDD：先新增 Fake/SQLite 双冲突反例，确认 SQLite 旧实现失败，再写最小预检。

## Plan of Work

### Batch 1 · 方案与红灯 draft

**最小闭环**：在共享 contract 中写双冲突测试，旧 SQLite 实现失败。
**涉及文件**：`tests/contract/suites/storage-identity-membership.js`、本 ExecPlan。

- [x] seed i1→issue1、i2→issue2
- [x] 写入 id=i1、natural key=issue2
- [x] 断言两适配器同一拒绝；拒绝后两行逐字段不变
- [x] 保留合法 natural-key replay 和既有冲突用例
- [x] 创建 draft PR、native Closes #310 回读

### Batch 2 · Fake/SQLite 统一实现

**最小闭环**：SQLite 预检 same-id 与 same-natural-key，双冲突 fail-closed。

**涉及文件**：`packages/storage/sqlite/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/capabilities/src/storage.ts`。

- [x] 统一错误与 precedence 规则
- [x] 确保预检在 adapter atomic/queue boundary 内
- [x] natural-key replay 只改变 role，不改稳定身份

验证：

```sh
node --test tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js
node_modules/.bin/tsc --noEmit
```

### Batch 3 · 对抗验收与 ready

运行 full storage contract、integration/restart、boundaries、workflow、size、disclosure、diff-check；独立复评通过后置 ready。2026-10-13 已完成 current-head MMP 复评；双适配器 guard 变异均被目标测试 KILLED。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 双冲突一致拒绝 | Fake/SQLite 共享反例同一错误 |
| 2 | 拒绝保持两行不变 | 写前/写后逐字段 snapshot 相等 |
| 3 | 合法 natural replay | stable id/entity/binding/kind/externalId，只有 role 可变 |
| 4 | 既有 identity constraints | exactly-one-primary 与 unknown kind 回归全绿 |
| 5 | 规模/公开面 | size≤800/1300、disclosure、diff-check、native links |

## Progress

- [x] 读取 current main、#310、Fake/SQLite identity methods、#190/#201（2026-10-12）。
- [x] 完成独立设计与反方选择；采用双冲突 fail-closed（2026-10-12）。
- [x] Batch 1 红灯与 draft PR（2026-10-12）。
- [x] Batch 2 实现；SQLite 旧实现红灯，修复后 storage contract + identity integration 154/154、typecheck 通过（2026-10-12）。
- [x] Batch 3 full regression、独立复评与 ready（2026-10-12）。

## Surprises & Discoveries

- 2026-10-12：Fake 已拒绝双冲突，SQLite 会自然键 UPSERT 改写另一条记录的 role；这是可复现的 adapter parity 缺口。
- 2026-10-12：#309 parser own-property 与 #311 snapshot alias 均触及 storage 测试，但不共享同一闭环，不能为了减少 PR 数量聚合。
- 2026-10-12：Fake 已拒绝双冲突，SQLite 原先会自然键 UPSERT 改写 owner；统一 same-id/same-key 预检后两适配器都 fail-closed。

## Decision Log

- 2026-10-12：选择 fail-closed，不选择 natural-key-wins 或 id-authoritative rebinding；理由是稳定身份和错误可见性优先。
- 2026-10-12：#310 单独 PR；#311 后置串行，避免 Fake Storage 文件交集和 invariant 混淆。
- 2026-10-12：采用 `atomic`/队列内双读预检；不把 alias/snapshot clone 或 schema migration 带入本 PR。

## Idempotence and Recovery

拒绝路径不写入；合法 replay 可重复执行。回滚为反向提交，无 schema/data migration。若 adapter 预检失败，事务/队列整体保持原状。

## Interfaces and Dependencies

Fake MemoryStorage、SQLite Storage、Storage contract suite、identity schema tests、Node/TypeScript/rule-check scripts。

## Outcomes & Retrospective

当前实现结果：共享 identity foundation 新增 2 个判别性用例；旧 SQLite 实现先红，修复后 storage contract + identity integration 154/154、额外 integration/e2e 89/89、full `pnpm verify`（作者记录 1484 + 7 tests）、typecheck、规则检查与独立复评通过。PR #325 current head 已由评审账号 APPROVE；分支落后 main，合并前须重锁并重跑 required checks。计划随最终交付提交归档。

## Bottom Change Note

- 2026-10-12：创建 #310 ExecPlan；基于 Fake/SQLite 复现和三份新 issue 组合分析，选择双冲突 fail-closed 独立闭环。
- 2026-10-12：完成 Batch 1–2，推送 PR #325；独立复评与 full verification 通过后已置 ready；#311 保留为后续串行闭环。
- 2026-10-13：完成 current-head MMP 评审、Fake/SQLite guard 变异验证、公开面与 issue 交叉追踪；评审记录写入 `docs/review/pr-325-mmp-review.md`，计划归档前等待 rebase 后最终回读。
