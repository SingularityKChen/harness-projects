# 栈内五个不变量缺口 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：修掉 PR #85 / #92 / #93 / #94 / #95 上五条未解决的 P1 评审意见。它们分属不同子系统，但根因同类——**不变量只在"顺利路径"上成立，没有被拥有事实的那一层强制**。
> 上游输入：评审线程 `PRRT_kwDOUekeas6kNi_A`(#85)、`PRRT_kwDOUekeas6kNi_N`(#92)、`PRRT_kwDOUekeas6kNi_O`(#93)、`PRRT_kwDOUekeas6kNjTL`(#94)、`PRRT_kwDOUekeas6kNjTO`(#95)；`AGENTS.md` §1.1

## Purpose / Big Picture

完成后，五个不变量在**非顺利路径**上同样成立：

| # | 不变量 | 现在的缺口 |
|---|---|---|
| #85 | 内存存储只有一个写者路径 | 事务排队了，直接写入没有：在途事务提交时会吞掉并发的直接写 |
| #92 | 本地投影必须收敛到 provider 的当前事实 | 全量同步只 upsert：provider 已删除的条目仍留在本地并可查询 |
| #93 | Start Work 在中断后可恢复 | 认领已持久化，但供应不可恢复：崩在供应中间会永久停在 Provisioning |
| #94 | 谱系只包含被观察到的事实 | 没有观察到提交时仍按 `commit: undefined` 读取仓库流水线，凭空出现 CI 跳 |
| #95 | 工作区修订号单调不减 | 修订号由最大实体修订推导：删掉最高修订的实体会让修订号倒退 |

最小成功证据：每个批次都有**判别性用例**（在缺陷存在时必须红），且五条注入实验各自可复现。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 直接写入 | 不经 `transaction()` 的 port 方法调用（如 `putWorkspace`） |
| 全量同步 | 一次完整分页读完 provider 当前集合的 bootstrap；中途失败或降级不算 |
| 认领 | `claimContext` 在存储事务里写入 Provisioning 行的动作 |
| 观察事实 | 由 provider 真实返回、而非由 core 推断出的跳 |

### 当前事实（本计划开始时）

- 五个分支都已 rebase 到各自 base 的最新 head，工作区干净；#86 / #87 / #88 上没有评审线程。
- 五条意见都已逐条对照代码确认属实（见各批次"根因"）。
- 栈序：`#85 → #88 → #86 → #87 → #92 → #93 → #94 → #95`；#85 的 base 是 `main`。

## Design / Spec

### D1（#85）存储只有一个写者路径

`this.data` 有两个入口：事务队列与直接写入。修法不是给直接写入加锁，而是**让所有变更都走同一条队列**：直接方法把自己排进队列（成为一次微变更），事务仍然是「排队 → 克隆 → 执行 → 换入」。读方法直接读已提交状态，因此 `await putX()` 之后的读仍能看到自己的写入。

判据：在途事务挂起期间发起的直接写入**不得丢失**；事务抛错仍然整体回滚；一次事务失败不阻断后续写入。

### D2（#92）全量同步必须收敛，且只在"完整"时收敛

投影是 provider 事实的缓存，provider 不再返回的条目必须从本地移除。两条约束：

1. **只在完整读完时移除**：分页全部成功、没有降级、没有中途失败，才允许删除本地多余投影；否则一次瞬时部分响应会误删。
2. **在同一事务里做**：写入观察到的集合与移除消失的投影必须在同一次 `transaction` 内，避免出现"新集合已写、旧条目还在"的中间态。

移除范围限定为该 workspace 的规划投影（及其内容实体/身份），并保留其它工作区的投影——一个工作区只投影一个 Planning Project。

### D3（#93）认领必须可恢复：恢复 = 幂等重放，而不是重开

崩在供应中间时，下一次 `startWork` 看到 Provisioning 上下文，应当**继续把它做完**，而不是把 `writing` 永久返回给调用方。可恢复的前提是每一步都幂等：

- 建分支/工作树：目标已存在时复用（替身已返回 `conflict`；core 必须把 conflict 解释为"已存在即可复用"，而不是失败）；
- 启动执行运行：先查该上下文是否已有运行记录，有则复用，不重复启动；
- 全过程不改上下文 id，因此"同一工作项 + 仓库至多一个上下文"仍然成立。

不采用"标记失败并允许新建"：上游发布计划明确要求 Start Work 重试必须**识别已经存在的** ExecutionContext / worktree / branch，而不是丢弃它。

### D4（#94）没有锚点就不读事实

流水线/检查这类事实必须挂在**已观察到的提交或变更请求**上。`head` 未观察到时不得调用 `readPipelines`（更不得以 `commit: undefined` 读取整个仓库的运行）；此时保留"缺哪一跳"的骨架标记，而骨架按上一轮修复不进谱系。

### D5（#95）修订号属于工作区，不属于实体

快照修订号是**工作区级**的单调计数器（`storage.advanceRevision` / `currentRevision`），实体修订只是元数据。`revisionOf()` 从实体推导修订号，等于把工作区事实降级成实体事实的派生值——删除最大修订的实体会让计数器倒退，订阅方的缺口检测随之失效。修法：快照与增量的 revision 一律取持久化的工作区修订号。

### D6 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| #85：给直接写入单独加锁 | 两条写路径仍然存在，锁只能减少窗口，不能消除"提交时覆盖"的语义错误 |
| #85：事务提交前比对版本，冲突即失败 | 引入契约外的失败模式，把并发写入变成调用方要处理的错误 |
| #92：把消失的条目标记为 stale 而不是移除 | 投影仍会返回 provider 已不存在的事实，只是换了个字段名 |
| #92：每次 upsert 后立即删除未见到的条目 | 分页中间态会误删：第一页返回后，第二页的条目会被当成"已消失" |
| #93：标记失败并允许新建上下文 | 丢弃已创建的工作树/分支，且与"重试必须识别既有上下文"的要求冲突 |
| #94：在返回时过滤空提交的流水线 | 事实仍然被读进来、落成关系；边界要在读取处强制 |
| #95：用 `Math.max(旧修订, 推导值)` 打补丁 | 掩盖了"修订号来源错误"这个根因，且空快照仍会停滞在旧值 |

## Global Constraints

- 每个 PR 只改自己拥有的文件：#85 → `packages/providers/fake/src/storage.ts` 与其契约用例；#92 → `packages/core/src/bootstrap.ts` 等；#93 → `packages/core/src/start-work.ts`、`git-provisioning.ts`；#94 → `packages/core/src/chain-facts.ts`；#95 → `packages/controller/src/wire.ts`。测试各归其层。
- 不新增运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行。
- 每个 PR 代码 ≤ 1000 行、文档 ≤ 1500 行（按各自声明的 base 度量）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · #85：统一写者路径

**最小闭环**：直接写入与在途事务不再互相覆盖。
**涉及文件**：`packages/providers/fake/src/storage.ts`、`tests/contract/storage-contract.test.js`
- [x] 所有变更方法走同一队列；事务保持「克隆 → 执行 → 换入」
- [x] 判别性用例：事务挂起期间的直接写入在事务提交后仍然存在
- [x] 注入实验：把直接写入改回直写 `this.data` → 用例必须红
**验证**：`node --test tests/contract/storage-contract.test.js`、全量三层测试、`node_modules/.bin/tsc --noEmit`、`size origin/main`
**回滚**：`git revert`；回到"事务间串行、直接写入可被吞掉"的上一版。

### Batch 2 · #92：全量同步收敛

**最小闭环**：provider 不再返回的条目从本地投影中消失。
**涉及文件**：`packages/core/src/bootstrap.ts`（及其调用的存储方法）、`tests/e2e/chain-bootstrap.test.js`
- [ ] 完整分页成功后，在同一事务内移除本工作区中未再出现的投影与内容实体
- [ ] 降级或中途失败时**不移除**
- [ ] 判别性用例：同步 N 条 → provider 成功返回空集合 → 再同步 → 查询返回 0 条；降级同步不删
- [ ] 注入实验：去掉移除逻辑 → 用例必须红
**验证**：`node --test tests/e2e`、全量三层测试、`tsc --noEmit`、`size test/mvp0-chain-assertion`
**回滚**：`git revert`。

### Batch 3 · #93：认领后可恢复

**最小闭环**：崩在供应中间后，下一次 startWork 把同一个上下文做完。
**涉及文件**：`packages/core/src/start-work.ts`、`packages/core/src/git-provisioning.ts`、`tests/e2e/start-work.test.js`
- [ ] 遇到已存在的 Provisioning 上下文时**继续供应**（而不是直接返回 writing）
- [ ] 供应各步幂等：分支/工作树已存在即复用（把 `conflict` 解释为已存在）；执行运行先查后启
- [ ] 判别性用例：认领后注入中断 → 新幂等键的 startWork 完成该上下文，且工作树/分支/运行各只有一份
- [ ] 注入实验：把"继续供应"改回"直接返回" → 用例必须红
**验证**：`node --test tests/e2e/start-work.test.js`、全量三层测试、`tsc --noEmit`、`size feat/core-bootstrap`
**回滚**：`git revert`。

### Batch 4 · #94：无锚点不读流水线

**最小闭环**：没有观察到提交/变更请求时，不产生任何 CI 事实。
**涉及文件**：`packages/core/src/chain-facts.ts`、`tests/e2e/delivery-lineage.test.js`
- [ ] `head` 未观察到时不得读取流水线（也不得以 `commit: undefined` 读取整个仓库）
- [ ] 判别性用例：新 core（未 bootstrap、未 startWork）→ 谱系 0 跳、无 CI 关系；真实链路走完后 CI 跳出现
- [ ] 注入实验：恢复无条件读取 → 用例必须红
**验证**：`node --test tests/e2e/delivery-lineage.test.js`、`node --test tests/mvp0`、全量三层测试、`size feat/core-start-work`
**回滚**：`git revert`。

### Batch 5 · #95：修订号取工作区持久值

**最小闭环**：快照与增量的修订号单调不减，缺口检测不被倒退欺骗。
**涉及文件**：`packages/controller/src/wire.ts`、`tests/e2e/client-sync.test.js`
- [ ] 快照/增量 revision 取持久化的工作区修订号；实体修订只作元数据
- [ ] 判别性用例：删除最高修订实体（或同步到空集）后 revision 不减小，且订阅方仍能识别变化
- [ ] 注入实验：改回从实体推导 → 用例必须红
**验证**：`node --test tests/e2e/client-sync.test.js`、全量三层测试、`size feat/core-delivery-lineage`
**回滚**：`git revert`。

### 收尾 · 级联与交付
- [ ] 五个批次完成后，按栈序逐层 `rebase --onto` 到新父（#85→#88→#86→#87→#92→#93→#94→#95），每层复验
- [ ] 各 PR 整理提交（折叠 docs/fixup），建恢复锚点后精确强推
- [ ] 逐条回复并 resolve 五条线程；回读 head/base/checks

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 直接写入不被在途事务吞掉 | #85 判别性用例 + 注入实验 | 待验证 |
| 2 | 全量同步收敛、降级不删 | #92 两条用例 + 注入实验 | 待验证 |
| 3 | 认领后可恢复且幂等 | #93 用例（中断后完成、工作树/分支/运行各一份） | 待验证 |
| 4 | 无锚点不读 CI 事实 | #94 用例（新 core 0 跳、无关系） | 待验证 |
| 5 | 修订号单调 | #95 用例（删最大修订实体后不倒退） | 待验证 |
| 6 | 五条注入实验各自变红 | 各批次记录 | 待验证 |
| 7 | 栈级联后每层自洽 | 逐层 `tsc` + 全量测试 + `mvp0` + `size` | 待验证 |

## Progress

- [x] (2026-09-21) 取证：五条意见逐条对照代码确认属实
- [ ] Batch 1 · #85 统一写者路径
- [ ] Batch 2 · #92 全量同步收敛
- [ ] Batch 3 · #93 认领后可恢复
- [ ] Batch 4 · #94 无锚点不读流水线
- [ ] Batch 5 · #95 修订号取工作区持久值
- [ ] 级联、整理提交、推送、回复、resolve

## Surprises & Discoveries

（实现期间如实记录。）

## Decision Log

- **Decision**：五条一起修，但每个 PR 只改自己的文件与用例。
  **Rationale**：它们分属存储替身、core 投影、Start Work、交付谱系与 controller 五个不同所有权区，互不共享写入区域；合并成一个 PR 会让"哪条不变量被破坏"无法单独定位与回滚。
  **Date/Author**：2026-09-21 / agent

- **Decision**：#92 只在完整分页成功后移除消失的投影。
  **Rationale**：投影是 provider 事实的缓存，但"当前集合"只有在完整读完时才成立；分页中间态删除会把尚未读到的条目当成已消失。
  **Date/Author**：2026-09-21 / agent

- **Decision**：#93 选择"继续供应"而不是"标记失败"。
  **Rationale**：上游发布计划要求 Start Work 重试识别已存在的 ExecutionContext / worktree / branch；丢弃它们会把已创建的外部产物变成孤儿。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 五个批次的验证命令都是只读且可重复的；注入实验均要求还原并复跑确认。
- 级联使用 `--onto <新父> <旧父>`，逐层复验累积文件集（"变基成功"不等于"内容正确"）。
- 每个分支已推送，改写前先建恢复锚点并用精确 `--force-with-lease`。

## Interfaces and Dependencies

- 依赖：`Storage` 契约（`transaction` / 直接方法）、`DevelopmentProvider`（分支/工作树的 conflict 语义）、`DeliveryProvider`（按提交读流水线）、controller 的 wire 修订号契约。
- 后续工作项：跨进程唯一性仍属存储层（SQLite 唯一索引/事务，#27/#28）；本计划只保证单 Host 语义正确。

## Outcomes & Retrospective

完成后填写：五条注入实验的实测结果、级联中遇到的问题、以及"还有哪些不变量只在顺利路径上成立"的剩余清单。

## Bottom Change Note

- 2026-09-21：首次创建。原因：栈内五个 PR 各有一条 P1，根因同类——不变量只在顺利路径上成立，没有被拥有事实的那一层强制。
