# 核心不变量执行缺口 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：修掉 PR #93 与 PR #94 上各一条未解决的 P1 评审意见。两条都属于同一类缺陷——**不变量只被顺序场景满足，没有被执行点强制**；本计划把强制点前移到缺陷发生处，并把 #94 的修复从上层 PR 下移回引入它的 PR。
> 上游输入：issue #77、#78；评审线程 `PRRT_kwDOUekeas6kIwjJ`（#93 竞态）与 `PRRT_kwDOUekeas6kIwjI`（#94 骨架进谱系）；证据归档 `docs/review/pr-93-mvp-review.md`、`docs/review/pr-94-mvp-review.md`；`AGENTS.md` §1.1

## Purpose / Big Picture

完成后：

- `startWork` 在**并发**下也只产生一次供应动作：同一 `(workspace, workItem, repository)` 的两个并发调用不会各自建工作树/分支/执行运行；
- 交付谱系里**只有被观察到的事实**：新建 core 既不 bootstrap 也不 startWork 时，读回 0 跳，且本地不留下任何骨架关系；
- 两条修复都落在**引入缺陷的那个 PR** 上，而不是它的上层——每个 PR 都能被独立验收、合并、回滚。

最小成功证据：

```bash
# #93 分支
node --test tests/e2e/start-work.test.js        # 含并发重叠用例
# #94 分支
node --test tests/e2e/delivery-lineage.test.js  # 含"新 core 无谱系、无骨架关系"的负向用例
node --test tests/mvp0                          # 两个分支上都应保持 7/7（#94 上）
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| check-then-act | 先查询再动作的临界区；中间被插入另一个调用就会重复动作 |
| 骨架跳 | 交付谱系里 `observed=false` 的位置标记：它说明"缺哪一跳"，不是"这一跳存在" |
| 供应（provision） | `startWork` 里产生外部副作用的那一段：建工作树、建分支、启动执行 |

### 当前事实

- **#93**（`packages/core/src/start-work.ts:47-54`）：`ledger.replay()` → `getExecutionContext()` → `provision()`。`contextIdFor(workspace, workItem, repository)` 是确定性的，因此两个并发调用算出**同一个** contextId，却各自执行一遍 `provision()`：结果是同一行上下文被两次写入 + 两份 provider 副作用（工作树、分支、执行运行）。现有用例只在第一次调用**完成之后**才发起第二次。
- **#94**（`packages/core/src/delivery.ts:131-133`）：`chainEdges(facts)` 直接交给 `recordEdges`，其中包含 `observed=false` 的骨架跳；于是从未走过的链路也会被读回 6 跳，并把骨架落成关系状态。对抗验证与评审各自复现过这一点。
- #94 的修复此前只做在**上层 #95**（`b91b031` + `0360709`），#94 自身仍带缺陷——这违反"每个 PR 独立可验收"。本计划把这两笔下移到 #94。
- 两个 PR 的分支都在同一栈内（#93 → #94 → #95），main 未移动，因此不需要变基到 main。

## Design / Spec

### D1（#93）不变量必须在动作发生处被强制，而不是在动作之后被检查

`(workspace, workItem, repository)` 至多一次供应，是一条**并发不变量**。顺序用例通过不能证明它成立。强制点必须包住「查账本 → 查上下文 → 供应」这三步，使第二个调用要么看到已存在的结果，要么明确冲突，而不是再供应一次。

### D2（#93）在事实拥有者处原子认领

`startWork` 用 `Storage.transaction` 原子完成「读上下文 → 写 Provisioning 认领」。离线替身的事务队列串行化重叠调用；SQLite 落地时由唯一索引/事务承担同样职责，因此单实例与跨实例都不会重复供应。进程内互斥不再参与该不变量。

### D3（#94）推断出的拓扑不得成为存储事实

骨架跳只保留「缺哪一跳」的位置信息。`observed=false` 的边**既不落成关系、也不进谱系**：过滤发生在 `recordEdges` 之前，因此本地状态里也不会出现骨架关系。这条把"事实/观察边界"写进代码，而不是靠调用方自律。

### D4 修复必须落在引入缺陷的 PR 上

#94 的修复下移到 #94 自身（`b91b031` 的过滤 + `0360709` 的 mvp0 断言硬化），#95 在变基时把这两笔识别为已应用而跳过，只保留 controller/client 与门禁提升。判据来自 `AGENTS.md` §8：每个 PR 必须是一个可独立验收、合并、回滚的能力闭环。

### D5 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 只加"重试时再查一次" | 仍然是 check-then-act：检查与动作之间依旧可以被插入 |
| 让 `provision()` 内部幂等（例如先建后查） | 副作用已经发生（工作树/分支/执行运行可能已创建），事后幂等不能撤销外部动作 |
| 用乐观校验（写入时比对版本，冲突即失败） | 会让"并发开始工作"变成用户可见的失败；语义上第二次调用应复用第一次的结果 |
| 只在 mvp0 断言里要求"没有骨架跳" | 断言收紧不等于实现正确；骨架仍会落进本地关系状态，被别的调用方读到 |
| 把 #94 的修复留在 #95 | 违反"每个 PR 独立可验收"；评审正是在这一点上打回 |

## Global Constraints

- #93 只改 `packages/core/src/**`、`tests/e2e/**`、`docs/exec-plan/active/2026-09-21-review-blockers-core-invariants.md`；#94 只改 `packages/core/src/delivery.ts`、`tests/e2e/**`、`docs/review/pr-94-mvp-review.md` 与本文件。
- 不新增运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行；core 不得 import provider 或 storage 实现。
- 每个 PR 代码 ≤ 1000 行、文档 ≤ 1500 行（按各自声明的 base 度量）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · #93：串行化 startWork 的临界区

**最小闭环**：并发重叠的两个 `startWork` 只产生一次供应，第二个调用复用第一个的结果。

**涉及文件**：`packages/core/src/start-work.ts`、`packages/core/src/context.ts`、`packages/core/src/index.ts`、`tests/e2e/start-work.test.js`

- [x] `startWork` 用 Storage transaction 原子完成「读上下文 → 写 Provisioning 认领」
- [x] 并发重叠用例在认领事务处交错，断言只有一个上下文、工作树、分支与执行运行
- [x] 跨 Core 实例共享 Storage 的并发用例断言同样的不变量
- [x] 注入实验：改为先读再写后，两条并发用例都无法完成（事务门控保持等待，证明测试有牙）
- [x] 删除进程内 keyed mutex 接线与实现

**验证**：`node --test tests/e2e/start-work.test.js`、`node --test tests/contract tests/integration tests/e2e`、`node_modules/.bin/tsc --noEmit`、`node scripts/rule-checks.mjs size feat/core-bootstrap`

**回滚**：`git revert` 本批提交；回到"顺序幂等成立、并发未串行化"的上一版。

### Batch 2 · #94：骨架跳不进谱系，并补负向用例

**最小闭环**：从未被观察过的链路读回 0 跳，本地不留骨架关系；修复随引入它的 PR 一起交付。

**涉及文件**：`packages/core/src/delivery.ts`、`tests/e2e/delivery-lineage.test.js`、`tests/mvp0/chain.test.js`（已随下移的提交落地）、`docs/review/pr-94-mvp-review.md`（归档评审证据）

- [x] 下移 `b91b031`（过滤 `observed=false`）与 `0360709`（mvp0 节点 3/5/6/7 断言真实观察）到 #94
- [ ] 负向用例：新建 core、不 bootstrap、不 startWork → 交付投影与谱系均为 0 跳，且存储里没有任何 `artifact_relation` 行
- [ ] 归档评审证据 `docs/review/pr-94-mvp-review.md`
- [ ] 注入实验：把过滤去掉 → 负向用例必须红

**验证**：`node --test tests/e2e/delivery-lineage.test.js`、`node --test tests/contract tests/integration tests/e2e`、`node --test tests/mvp0`、`node_modules/.bin/tsc --noEmit`、`node scripts/rule-checks.mjs size feat/core-start-work`

**回滚**：`git revert` 本批提交；回到"骨架跳进谱系"的上一版（即评审锁定的 head）。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 并发重叠只供应一次 | #93 的并发用例：上下文 1、工作树 1、分支 1、执行运行 1，两个结果同 contextId | 待验证 |
| 2 | 串行化有牙 | 注入实验：去掉互斥 → 并发用例红 | 待验证 |
| 3 | 新 core 无谱系 | #94 负向用例：0 跳 | 待验证 |
| 4 | 骨架不落本地状态 | 负向用例同时断言存储里没有骨架关系行 | 待验证 |
| 5 | 过滤有牙 | 注入实验：去掉过滤 → 负向用例红 | 待验证 |
| 6 | 修复落在正确的 PR | `git log feat/core-start-work..feat/core-delivery-lineage` 含过滤与断言硬化两笔；#95 变基后不再含重复补丁 | 待验证 |
| 7 | 门禁与体量 | 两个分支 `tsc` 干净、全量测试绿、mvp0 在 #94 上 7/7、size 在各自 base 的上限内 | 待验证 |

## Progress

- [x] (2026-09-21) 取证：两条 P1 均已复现（#93 竞态、#94 骨架进谱系）
- [x] (2026-09-21) #94 的两笔修复已从 #95 下移（cherry-pick `b91b031`、`0360709`）
- [x] Batch 1 · #93 串行化
- [ ] Batch 2 · #94 负向用例与证据归档
- [ ] #95 变基到新 #94 并丢弃重复补丁
- [ ] 推送、回复、resolve 两条线程

## Surprises & Discoveries

- **Observation**：#94 的 P1 在本会话早些时候已被发现并修复，但**修在了上层 PR（#95）**。#94 自身仍带缺陷，评审因此打回。
  **Evidence**：评审证据文档写明「The later #95 fix filters `edge.artifact.observed`; that repair is absent from this locked #94 head」。
  **Decision impact**：修复下移到引入缺陷的 PR。这不是"多此一举"：如果 #94 单独合并，缺陷就进了 `main`；栈的每一层都必须自洽。

## Decision Log

- **Decision**：#93 用 Storage transaction 原子认领，而不是进程内互斥或事后幂等。
  **Rationale**：认领必须在事实拥有者处完成，事务保证单实例与跨实例的「读上下文→写 Provisioning」不可交错；第二次调用复用已有上下文。
  **Date/Author**：2026-09-21 / agent

- **Decision**：#94 的过滤放在 `recordEdges` 之前，而不是只在返回时过滤。
  **Rationale**：如果只过滤返回值，骨架仍会落成本地关系状态并被其它调用方读到——"本地不得持有未观察事实"这条才是根因。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 两条修复都是纯代码路径，无外部副作用；验证命令只读且可重复。
- 下移提交用 `cherry-pick`；若 #95 变基时把这两笔识别为已应用，git 会跳过它们——这是期望行为，不是丢提交。
- 回滚单位是单个提交；#93/#94 的分支已推送，改写前先建恢复锚点并用精确 lease 强推。

## Interfaces and Dependencies

- **后续工作项**：跨进程的执行上下文唯一性必须由存储层强制（SQLite 唯一索引/事务，见 #27/#28）；进程内互斥只覆盖单进程 Host。
- 依赖：`packages/capabilities` 的 `Storage`/`ExecutionProvider`/`DevelopmentProvider` 契约（不改）；离线替身的可控挂起点用于构造确定性交错。

## Outcomes & Retrospective

完成后填写：并发用例的构造方式、两次注入实验的结果、#95 变基后是否干净地丢弃了重复补丁、以及"还有哪些不变量只在顺序场景下成立"的剩余清单。

## Bottom Change Note

- 2026-09-21：首次创建。原因：PR #93 与 #94 各有一条 P1，根因相同——不变量只在顺序场景被满足，没有被执行点强制；且 #94 的修复此前错误地留在上层 PR。
