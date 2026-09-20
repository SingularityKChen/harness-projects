# 内存存储事务串行化 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：修掉 PR #85 上唯一未解决的 P1 评审意见——`MemoryStorage.transaction()` 的重叠事务会丢掉已提交的写入；只改离线替身与它的契约测试。
> 上游输入：PR #85 的评审线程 `PRRT_kwDOUekeas6kIbrf`、issue #30、`packages/capabilities/src/storage.ts` 的 Storage 契约

## Purpose / Big Picture

完成后，`MemoryStorage` 的事务语义与它实现的契约一致：**并发事务串行执行，每个事务从上一个事务提交后的状态开始**；任何一次已确认的写入都不会被后来的事务静默覆盖。

最小成功证据：

```bash
node --test tests/contract/storage-contract.test.js   # 期望全绿，且含一条"重叠事务不丢写"的确定性用例
node --test tests/contract tests/integration tests/e2e
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 事务 | `Storage.transaction(work)`：`work` 内的写入要么全部生效、要么全部不生效 |
| 丢失更新 | 两个重叠事务各自克隆同一份快照，后者提交时覆盖前者已提交的写入 |
| 离线替身 | `packages/providers/fake` 里的内存实现，供契约套件与 MVP-0 链路在无凭据条件下使用 |

### 当前事实

- `MemoryStorage.transaction()` 的实现是：`structuredClone(this.data)` → `await work(draft)` → `this.data = draft`。
- 契约 `StorageTransaction = Omit<Storage, 'transaction'>` 明确**不允许嵌套事务**，因此串行化不会引入自死锁。
- 现有套件只覆盖"事务内抛错整体回滚"与"事务内写入生效"，没有覆盖重叠事务。
- 评审证据（真实缺陷）：T1 克隆 → 写 A → 挂起；T2 克隆（不含 A）→ 写 B → 提交；T1 恢复 → 用只含 A 的草稿整体替换 → B 消失。后果是"后续 core 并发测试可能对着一个会静默丢已确认状态的替身通过"。

## Design / Spec

### D1. 串行化，而不是乐观校验

内存替身是**测试替身**，它要复现的是契约的语义（全有或全无 + 串行可见性），而不是模拟数据库的并发控制。因此用一个 promise 队列把事务串起来：每个事务在前一个事务 settle 之后才开始克隆与执行。

### D2. 队列必须吸收失败，调用方仍然看到失败

一次事务抛错不能让后续事务永远排队：队列用 `run.then(noop, noop)` 续接，而 `transaction()` 返回的仍是会 reject 的那个 promise。这样"回滚"与"后续事务可继续"同时成立。

### D3. 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 乐观版本校验（提交时比对 revision，过期即失败） | 契约没有"事务可能失败于冲突"的语义；让替身引入契约外的失败模式，会把测试写成对替身实现细节的断言 |
| 每个 port 方法各自加锁 | 事务的原子性跨越多个方法调用，逐方法加锁挡不住重叠事务的整体替换 |
| 不改实现，只在测试里避免重叠 | 评审意见的核心正是"重叠会丢写"；不改就仍然是一个会静默丢状态的替身 |

## Global Constraints

- 只改 `packages/providers/fake/src/storage.ts` 与 `tests/contract/`（新增或扩展 storage 契约用例）、本文件。
- 不引入运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行。
- 不改变 `Storage` 契约本身（`packages/capabilities` 不动）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 事务串行化（服务于 PR #85 / issue #30）

**最小闭环**：重叠事务不再丢写，且回滚语义不变。

**涉及文件**：`packages/providers/fake/src/storage.ts`、`tests/contract/storage-contract.test.js`（或 `tests/contract/suites/storage.js`）

- [x] `transaction()` 改为队列串行：克隆与执行都在前一个事务 settle 之后
- [x] 队列吸收失败（不阻断后续事务），`transaction()` 仍把失败传给调用方
- [x] 新增确定性用例：用可控的挂起点构造 T1/T2 重叠，断言两者写入都在；并断言"事务内抛错不改变已提交状态"
- [x] 注入实验：把实现改回"克隆后无条件替换"，新用例必须变红

**验证**：

```bash
node --test tests/contract/storage-contract.test.js
node --test tests/contract tests/integration tests/e2e
node_modules/.bin/tsc --noEmit
node scripts/rule-checks.mjs size origin/main
```

**回滚**：`git revert` 本批提交；替身回到"重叠即丢写"的上一版，其余不受影响。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 重叠事务不丢写 | 新增用例：T1 挂起期间 T2 提交，T1 提交后两者都在 | 通过 |
| 2 | 回滚语义不变 | 既有"事务内抛错整体回滚"用例仍绿 | 通过 |
| 3 | 失败不阻断后续事务 | 新增或扩展用例：一次事务失败后，下一个事务仍能提交 | 通过 |
| 4 | 有牙 | 注入实验（改回无条件替换）→ 新用例变红 | 通过（`ws-t2` undefined） |
| 5 | 无契约外失败模式 | 用例不依赖"冲突失败"这类替身特有行为 | 通过 |

## Progress

- [x] Batch 1 · 事务串行化（2026-09-21）
- [x] (2026-09-21) 分支已在最新 `main` 之上（`cdf860a`），工作区干净

## Surprises & Discoveries

- **评审描述的时序只对缺陷实现成立。** 线程写的是"T2 完整提交、再放行 T1"，但串行化之后 T2 不可能先于 T1 提交（先 `await t2` 再放行 T1 会死锁）。确定性用例改为"T1 进入事务并挂起 → T2 入队 → 放行 T1 → 两者都提交"：修复前两个事务各自克隆同一份空快照，最终只剩后提交者的草稿，断言必然红；修复后按调用顺序串行，两笔写入都在。
- **给新用例加 `timeout`。** 若队列实现退化成"不吸收失败"，后续事务会永远排队，无超时的用例会把整个套件挂死而不是判红；两条新用例都带 5s 超时，让这类回归以失败而不是挂起的形式暴露。
- **`size` 门禁在本批之前就已顶格。** Batch A3 的代码改动是 995/1000 行（`origin/main...HEAD~1`），本批的根因修复加判别性用例至少需要约 20 行净增，因此 `node scripts/rule-checks.mjs size origin/main` 超过 1000 行上限。这不是本批引入的规模问题，而是"评审修复必须落在同一个 PR 上"与"该 PR 已顶格"的冲突，需要人类决定如何 re-baseline（见 Decision Log）。

## Decision Log

- **Decision**：串行化而不是乐观校验。
  **Rationale**：替身要复现的是契约语义，而不是数据库并发控制；引入契约外的冲突失败会让测试开始断言替身的实现细节。串行化让"重叠事务"在语义上退化为"顺序事务"，这是契约允许的最强保证。
  **Date/Author**：2026-09-21 / agent
- **Decision**：不为过 `size` 门禁而压缩既有文件；如实上报超限并交由人类决定 re-baseline 方式。
  **Rationale**：本批允许改动的文件里能挤出足够行数的只有 `tests/contract/suites/storage.js` 的 fixture 与文件头注释——那是为满足数字而做的机械改写，会制造与 P1 修复无关的审阅噪声，且 1000 行上限是 PR 级预算，正确做法是 re-baseline 或由 A3 批次自身瘦身，不是在评审修复里塞入格式化改动。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 纯内存实现，无外部副作用；验证命令只读且可重复。
- 回滚单位是单个提交。

## Interfaces and Dependencies

- 依赖 `packages/capabilities/src/storage.ts` 的 `Storage` / `StorageTransaction`（不改）。
- 上游：issue #30；本计划服务于 PR #85 的未解决 P1 线程。

## Outcomes & Retrospective

- **最终实现形状**：`MemoryStorage` 增加实例私有字段 `#queue`（初始 `Promise.resolve()`）。`transaction()` 把"克隆 → 执行 work → 提交草稿"整段排进队列；返回给调用方的仍是该段自身的 promise，队列引用则用 `run.then(noop, noop)` 吸收失败。因为 `StorageTransaction` 不允许嵌套事务，队列不会自死锁。
- **注入实验结果**：把 `transaction()` 改回"克隆后无条件替换"（保留 `#queue` 字段不用），重叠用例红，失败信息正是 `T2 已确认的写入不得被 T1 的提交覆盖`（`ws-t2` 为 `undefined`）；"失败后仍可提交"用例在旧实现下仍绿（旧实现没有队列，本来就不会阻断），说明该用例判别的确实是队列的失败吸收而不是修复本身。实验后已还原。
- **剩余清单（替身与契约仍可能不一致的语义）**：①事务外的单方法写入不受队列保护，与并发事务交错时仍可能被事务的草稿替换覆盖——契约未要求，但值得在 core 组合时留意；②没有嵌套事务检测，违反"不允许嵌套"时会静默工作而不是报错；③`data` 是公开字段，测试直接读写会绕过 port 语义；④无持久化，重启语义靠导出/导入模拟。
- **门禁**：`node --test tests/contract tests/integration tests/e2e` 240 通过、`node_modules/.bin/tsc --noEmit` 通过；`size origin/main` 超限（见 Surprises 与 Decision Log）。

## Bottom Change Note

- 2026-09-21：首次创建。原因：PR #85 的 P1 指出内存替身的事务会丢已提交写入；这是一个会污染后续所有并发相关测试的替身缺陷，必须按根因修而不是在用例里回避重叠。
- 2026-09-21：Batch 1 完成并记录实现形状、注入实验结果与 `size` 门禁的 re-baseline 请求。
