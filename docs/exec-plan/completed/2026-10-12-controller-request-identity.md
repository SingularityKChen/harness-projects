# Controller 请求身份与重放冲突 ExecPlan

> 状态：Completed
> 创建：2026-10-12
> 范围：修复 #306 的 Controller 请求身份边界；#307 的 in-flight 生命周期另成 stacked PR，不在本文件实施。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、issue #306、#307、#194、#204。

## Purpose / Big Picture

Controller 的同一个幂等键必须只代表同一个完整请求。换 actor、目标、命令参数或外部引用时，Controller 在调用 Core 之前返回结构化 `conflict`，不复用首个请求的结果，也不产生额外 mutation；同一完整请求仍可安全重放。Start Work 传给 Core 的 actor 必须保留 `id`。

最小成功证据是：`bootstrapWorkspace`、`startWork`、`applyPlanningStatus`、`confirmRelation`、`rerunPipeline` 各有同键变参反例；所有反例均证明 Core/Provider 调用次数为零。相同完整请求重放返回同一结果，结构化值编码对键序、undefined/null、数组顺序和类型差异可判别。

## Context and Orientation

`packages/controller/src/commands.ts` 的 `createReplayLog` 当前只用 `${commandName}:${idempotencyKey}` 作 key，在 `run()` 完成后才写入 Map。`runStartWork` 把 `actorRef` 降成 `{ kind }`，丢失 actor id。`confirmRelation` 与 `rerunPipeline` 的 ref 未进入 replay identity；status 的 entity/status 和 bootstrap 的 actor 也未进入。

issue #306 只拥有 Controller boundary 的身份缺口，不要求建立第二个持久命令权威。#194/#204 的 Host durable ledger 仍是跨重启写入事实源；本 PR 不改变 Storage schema、`findMutationAttempt` 或 core ledger。#307 的并发合并和 Pending/Unknown live replay 在下一份 stacked ExecPlan 处理。

## Design / Spec

### 方案比较

1. **Controller 私有 canonical fingerprint（采用）**：把命令名、完整 actorRef、目标和 payload 编成带版本/类型标签的确定性材料，计算 SHA-256；replay entry 保存 fingerprint。改动集中在 Controller，不扩大 capabilities API，不把 ephemeral Map 伪装成持久事实源。
2. **把 fingerprint 直接写入 Host durable ledger**：跨重启语义更强，但会同时修改 #194/#204 的 Storage 端口、schema 和 core owner，超出 #306 的 Controller boundary，且需要重新裁决跨命令持久键。延后。
3. **只拼接 JSON.stringify**：放弃。对象键序、undefined/null、类型和值边界会发生碰撞或未定义差异，不能作为请求身份。

### 采用方案

- 每个带幂等键命令构造 `RequestIdentity`：`version`、`commandName`、`actorRef`、`target`、`payload`。
- 使用结构化编码：对象键按 JavaScript 默认字符串序稳定排序，数组保序，primitive 带类型标签；`undefined`、`null`、数字、字符串、布尔分别编码；循环/unsupported value 返回 `invalid_input`，不调用 Core。
- Replay key 仍是命令名 + idempotencyKey；entry 另存 fingerprint 与 result。
- 同 key 不同 fingerprint 返回 `conflict`；同 fingerprint 返回缓存结果。
- `runStartWork` 传 `{ kind: actorRef.kind, id: actorRef.id }`。
- `refreshDeliveryFacts` 继续不进 replay，因为它没有幂等键并且语义是每次重新读取。
- 本 PR 不宣称跨 Controller 重启或跨进程幂等；这些仍由 Host ledger/未来 issue 负责。

### 关键不变量

1. 任何 mutation 前都已验证完整请求身份；身份冲突零 Core/Provider 调用。
2. 同一命令、同一幂等键、同一完整指纹才可复用结果。
3. Actor kind 与 id 端到端保留；不得在 Controller→Core handoff 中丢失。
4. 不同命令的相同幂等键在 Controller 层不串结果。
5. Controller replay 是短生命周期去重优化，不取代 Host durable ledger，也不进入公共 wire。
6. #307 的 in-flight Promise 竞态、Pending/Unknown live replay 不在本批。

### 独立设计与审查

独立设计结论分别建议 canonical fingerprint、B1→B2 stacked 边界和 Start Work actor 保留；独立对抗审查指出 Controller 不应成为第二 durable authority，并要求把 Pending/Unknown 留给 #307/Host ledger。该审查也发现 core durable ledger 的跨命令键风险，因其属于 #194/#204 的 owner，本 PR 记录为 follow-up，不偷改边界。

## Global Constraints

- 只修改 `packages/controller/src/commands.ts`、Controller 相关测试、本 ExecPlan；代码 ≤800 行，文档 ≤1300 行。
- 不改 Storage schema、Host ledger、Provider 接口、wire result、#194/#204 语义或 #307 生命周期。
- 生产代码先写并验证失败测试；测试通过 Core spy/Provider call count 证明冲突前无 mutation。
- 分支 `fix/controller-request-identity`；PR 使用 `Closes #306`，B2 使用独立 `Closes #307` 并以本分支为 base。

## Plan of Work

### Batch 1 · 红灯与 draft PR

**最小闭环**：在 Controller 入口证明同键变参当前会错误复用，且 actor id 当前丢失。

**涉及文件**：`tests/e2e/controller-roundtrip.test.js`、`tests/integration/start-work-retry-identity.test.js`、本 ExecPlan。

- [x] 添加 table-driven 反例：actor、target、payload、relation/ref、status、bootstrap 命令维度变更；断言 `conflict` 与 Core/Provider 调用次数不增。
- [x] 添加相同完整请求重放、对象键重排等正向用例。
- [x] 运行用例确认旧实现红灯，提交计划和测试，推送并创建 draft PR。

**验证**：

```sh
node --test tests/e2e/controller-roundtrip.test.js tests/integration/start-work-retry-identity.test.js
```

期望：新增身份冲突用例非 0；既有重放用例保留当前基线行为。

**回滚**：删除测试提交或精确回退到计划提交；不涉及数据迁移。

### Batch 2 · canonical fingerprint 与 actor handoff

**最小闭环**：身份冲突在 replay 前返回结构化 conflict，同请求复用结果，Start Work actor id 到达 Core。

**涉及文件**：`packages/controller/src/commands.ts`。

- [x] 实现版本化、类型安全、键序稳定的 canonical encoder/fingerprint。
- [x] replay entry 保存 fingerprint；不同指纹冲突且零 Core 调用。
- [x] 将完整 actorRef 传入 `core.commands.startWork`。
- [x] 保持 refreshDeliveryFacts 不进入 replay。

**验证**：

```sh
node --test tests/e2e/controller-roundtrip.test.js tests/integration/start-work-retry-identity.test.js
node_modules/.bin/tsc --noEmit
```

期望：身份测试与既有测试全绿，typecheck 退出码 0。

**回滚**：反向提交 Controller 代码和测试；Host ledger 无需修复。

### Batch 3 · 对抗验收与发布

**最小闭环**：验证各命令身份覆盖、公开面、规模和 stacked 边界。

**涉及文件**：本 ExecPlan 与测试。

- [x] 增加 key collision 对抗：undefined/null、数字/字符串、数组顺序、对象键序、外部 ref 全字段。
- [x] 确认冲突不进入 Core/Provider，wire 不暴露 raw request/fingerprint。
- [x] 运行 boundaries、workflow、size、disclosure、diff-check；整理 commit。
- [x] 推送后回读 PR head/base/checks、closingIssuesReferences、labels、milestone 和 threads；验证通过后置 ready。

**验证**：

```sh
node --test tests/contract/package-boundaries.test.js
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs size origin/main
node scripts/rule-checks.mjs disclosure origin/main
git diff --check origin/main...HEAD
```

期望：所有命令退出码 0，代码/文档规模在门禁内。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 同键变 actor conflict | actor kind/id 变更返回 conflict，Core 调用数为 0 |
| 2 | 同键变目标或 payload conflict | 每个命令的目标/ref/payload 变更均零 mutation |
| 3 | 同完整请求 replay | 相同指纹返回原结果且不重复调用 |
| 4 | 编码 collision-safe | 键序、undefined/null、数组顺序、类型差异用例通过 |
| 5 | Start Work actor 保留 | Core spy 收到完整 actorRef |
| 6 | 跨命令隔离 | 同幂等键用于不同 command 不串结果 |
| 7 | 不越过 Host ledger 边界 | 无 schema/Storage 变更；#307 Pending/Unknown 留给后续栈 |

## Progress

- [x] 读取当前 main、相关 issue、Controller/Core 代码和边界文档。
- [x] 完成三份独立设计/对抗结论；记录 core durable ledger follow-up 风险。
- [x] Batch 1 红灯；旧实现对 actor/target/参数变更错误复用结果。
- [x] Batch 2 实现 canonical request identity 与 actor handoff。
- [x] Batch 3 对抗验收和 ready；PR #317 已置 ready，required PR Fast Gate 与本地验证通过，等待人类评审。
- [x] 评审后补齐跨 command 隔离与数组顺序反例；复评记录写入 `docs/review/pr-317-mmp-review.md`。
- [x] 复评当前 head `c83fca2`：P2/P3 已处理，review threads 已回复并 resolve，所有当前 checks 通过。

## Surprises & Discoveries

- 2026-10-12：Controller Map 与 Host durable ledger 是两个身份域；#306 只修 Controller boundary，不能在本 PR 偷改 #194/#204 的 Storage owner。
- 2026-10-12：`runStartWork` 当前丢失 actor id；`confirmRelation`/`rerunPipeline` 的 ref 也未进入 replay identity。
- 2026-10-12：#307 的 Pending/Unknown live replay 需要 Host 当前状态读取；不能对没有 durable/read-back 合同的命令盲目重调外部写。
- 2026-10-12：TDD 红灯验证在临时恢复旧 Controller 后，身份冲突和 undefined/null 反例均失败；恢复实现后相关 21 项用例与 typecheck 通过。

## Decision Log

- 2026-10-12：#306/#307 拆成 B1/B2 stacked PR；B1 只收敛身份，B2 只收敛 in-flight/lifecycle。
- 2026-10-12：采用 Controller 私有 canonical fingerprint，不引入第二个持久幂等权威。
- 2026-10-12：将 core durable ledger 跨命令键风险记为 #194/#204 follow-up，不扩大本 PR。
- 2026-10-12：为让 Controller→Core 保留 actor id，`StartWorkActor` 增加可选 `id`；不进入持久 schema。
- 2026-10-12：复评后将排序语义与实现统一为 JavaScript 默认字符串序，并补充跨 command 与数组顺序的判别性测试。

## Idempotence and Recovery

同完整请求可重复读取 Controller 缓存；不同指纹立即 conflict。Controller 重启会丢失 Map，跨重启语义由 Host ledger 决定；本 PR 不宣称持久幂等。回滚只需反向提交，无 schema/data repair。

## Interfaces and Dependencies

- `ControllerCommands`、`CommandEnvelope`、`ActorRef`、各 command target/ref 类型。
- Node `crypto` 的 SHA-256；如使用需保持当前 Controller 运行时边界和 browser-safe wire 不变。
- Core `startWork` actor request 类型。
- Node test、TypeScript、workflow/rule-check scripts。

## Outcomes & Retrospective

实际结果：初始实现代码增删 155 行、文档增删 177 行；评审修复新增跨 command 与数组顺序反例及复评记录，当前 head 为 `c83fca22935e435a50f4a5250c7a870c01c4e7c2`。相关命令测试 23 项、全量 `pnpm test` 1480 项、typecheck、边界、workflow、size、disclosure、diff-check 均通过；PR #317 已关联 #306、标签/milestone 已回读并置 ready，review threads 已 resolve。#307、#194、#204 保持后续 issue 边界。GitHub 的本地 DSH review session lane 因本地端点不可用而失败，该外部 review hook 不影响 PR Fast Gate。

## Bottom Change Note

- 2026-10-12：创建 B1 ExecPlan，基于 #306/#307 实时 issue、三份独立方案/审查和当前 Controller 代码确定 identity-only 边界。
- 2026-10-12：完成 Batch 1–2；相关 21 项测试与 typecheck 通过，等待 draft PR 发布和最终发布面验收。
- 2026-10-12：完成 Batch 3；PR #317 当前 head 已回读，#307 由 plan-only PR #320 承接。
- 2026-10-12：针对 reviewer 的 P2/P3 补充跨 command 同键隔离、数组顺序测试，并将排序语义与实现对齐；当前 head 已复评通过，计划归档。
