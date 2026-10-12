# Controller in-flight 重放与 Pending 收敛 ExecPlan

> 状态：Active
> 创建：2026-10-12
> 范围：在 #306 的完整请求身份之上修复 #307 的 Controller in-flight 合并与 Pending/Unknown live replay；本分支以 `fix/controller-request-identity` 为栈底。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/exec-plan/active/2026-10-12-controller-request-identity.md`、issue #307。

## Purpose / Big Picture

同一个完整请求并发到达 Controller 时只调用一次 Core/Provider；同一请求的 `Pending` 或 `Unknown` 结果不能永久冻结为旧答案。Start Work 的后续重放重新进入 Core，由 Host durable ledger / read-back 取得当前状态；不同请求互不串结果；Rejected Promise 清理 in-flight，不污染终态缓存。

最小成功证据是：barrier 让两个同请求并发调用同时等待，Core 调用计数为 1；首次返回 Pending 后 Core 状态推进，下一次同请求返回当前终态；拒绝后再次调用可继续；终态重放不产生额外写入。

## Context and Orientation

栈底 #306 已把 replay entry 绑定到完整 request fingerprint，并保留 Start Work actor id。当前 `createReplayLog` 仍只在 `run()` 完成后写入结果，两个并发调用会同时 miss；它也会把 Pending/Unknown 当成终态缓存。

当前 Core 只有 Start Work 明确拥有 durable idempotency ledger 和 read-back 状态；bootstrap/status/relation/rerun 的 Controller 结果没有同等的持久 operation contract，也不会自然返回 Pending。故本 PR 的 live replay 语义只对 `startWork` 的 Pending/Unknown 生效；其他命令的当前终态集合保持原有缓存语义，不盲目重调外部写。

## Design / Spec

### 方案比较

1. **inFlight Promise + terminal cache（采用）**：同指纹先登记 Promise，再运行；完成后只缓存终态；Pending/Unknown 的 Start Work 不进入终态缓存，下一次从 Core 读取当前 Host 状态。Rejected Promise 在 `finally` 清理。
2. **只加调用锁，不区分 Pending/Unknown**：能防并发双写，但会把 Pending 永久冻结。放弃。
3. **所有命令 Pending/Unknown 都盲目重调外部写**：没有 durable/read-back 合同的命令会重复外部写。放弃。

### 采用方案

- replay key/fingerprint 使用 #306 的 canonical identity，不建立第二个 durable authority。
- `inFlight` entry 保存 `{ fingerprint, promise }`，在调用 `run()` 前登记；相同指纹返回同一 Promise，不同指纹立即 conflict。
- Promise 成功后：`startWork` 的 Pending/Unknown 不写 terminal cache；Confirmed/Reconciled/LocalOnly/Failed/Conflict 仍按既有语义缓存。
- Promise reject 后：不写 terminal cache，`finally` 删除 inFlight；下一次请求可重新运行。
- 同键 Pending/Unknown 的下一次请求重新调用 `core.commands.startWork`，依赖 Host durable ledger / read-back，不能由 Controller 猜测完成或再次直接调用 Provider。
- `refreshDeliveryFacts` 继续不进 replay；它是每次真实读取。

### 关键不变量

1. 同一完整请求并发只执行一次 Core/Provider。
2. 不同 fingerprint 即使同幂等键也不共享 Promise/result。
3. Pending/Unknown 不被永久缓存；Start Work replay 可以向 Host 当前状态前进。
4. Rejected Promise 不污染终态缓存，后续调用不挂死。
5. 终态重放不产生额外外部写。
6. Controller in-flight/cache 是短生命周期优化，跨重启与跨进程持久语义由 Host ledger 负责。

### 独立设计与审查

独立设计建议 B1→B2 stacked；另一份边界审查要求 Pending/Unknown 只在有 durable/read-back 合同的 Start Work 上 live replay，禁止对其他命令盲重调用外部写；与 #306 的 reviewer 结论一致。

## Global Constraints

- 只修改 `packages/controller/src/commands.ts`、Controller 相关测试、本 ExecPlan；代码 ≤800 行，文档 ≤1300 行。
- 不改 Storage schema、Host ledger、Provider 接口、wire DTO 或 #306 的 canonical encoder。
- 生产代码先写能正确失败的 barrier/replay 测试；不使用 sleep 代替同步门。
- 分支 `fix/controller-live-replay`，base 是 `fix/controller-request-identity`；PR 使用 `Closes #307`。

## Plan of Work

### Batch 1 · 红灯与 stacked draft

**最小闭环**：证明旧 replay 在并发同请求下重复 Core，并把 Pending 永久冻结。

**涉及文件**：`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/start-work.test.js`、本 ExecPlan。

- [ ] 用 Core spy/barrier 写两个 simultaneous identical `startWork` 调用，旧实现先红。
- [ ] 用可控 Core 结果序列写 Pending→Confirmed replay，旧实现先红。
- [ ] 提交计划与红灯测试，创建以 #306 为 base 的 stacked draft PR。

**验证**：

```sh
node --test tests/e2e/controller-roundtrip.test.js tests/e2e/start-work.test.js
```

期望：新增并发/推进用例非 0，失败来自重复调用或旧 Pending。

### Batch 2 · in-flight coordinator

**最小闭环**：先登记 Promise，再运行；成功终态缓存，拒绝清理。

**涉及文件**：`packages/controller/src/commands.ts`。

- [ ] 扩展 replay log 保存 `inFlight` fingerprint/promise。
- [ ] 同指纹并发返回同一 Promise；异指纹 conflict。
- [ ] `finally` 删除 inFlight；Promise reject 不写终态。
- [ ] 仅 `startWork` Pending/Unknown 不写终态缓存。

**验证**：

```sh
node --test tests/e2e/controller-roundtrip.test.js tests/e2e/start-work.test.js tests/e2e/write-machine.test.js
node_modules/.bin/tsc --noEmit
```

### Batch 3 · 对抗验收与 ready

**最小闭环**：验证不同 key 隔离、终态 no-extra-write、公开面和栈关系。

**涉及文件**：相关测试、本 ExecPlan。

- [ ] 注入不同 key 并发、Rejected Promise、Unknown 和 Host read-back 失败。
- [ ] 运行 boundaries/workflow/size/disclosure/diff-check。
- [ ] 推送后回读 PR base=`fix/controller-request-identity`、head、checks、closing references 和 threads；通过后才置 ready。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 同请求并发合并 | barrier + Core/Provider call count = 1 |
| 2 | Pending→current | Start Work 首次 Pending，后续同请求读到当前终态/Unknown |
| 3 | Rejected recovery | 首次 Promise reject 后第二次仍可运行 |
| 4 | 不同请求隔离 | 不同 key/fingerprint 各自运行，不共享结果 |
| 5 | 终态重放不重复写 | Confirmed/Reconciled replay 不增加 provider call |
| 6 | Host ledger owner 保持 | 无 schema/Provider/公共 wire 变更；跨重启不由 Controller 宣称 |

## Progress

- [x] 读取 #307、#306、Controller replay 与 Start Work durable ledger 事实。
- [x] 完成独立设计与边界审查。
- [ ] Batch 1 红灯和 stacked draft PR。
- [ ] Batch 2 实现。
- [ ] Batch 3 对抗验收和 ready。

## Surprises & Discoveries

- 2026-10-12：只有 Start Work 当前有明确 Host durable/read-back 合同；其他命令不能把 Pending/Unknown live replay 泛化成盲重写。
- 2026-10-12：#306 的 fingerprint 必须先于 in-flight 注册，否则同 key 异请求会共享 Promise。

## Decision Log

- 2026-10-12：B2 以 #306 为 stacked base；B1 identity 与 B2 lifecycle 分开，保持独立回滚。
- 2026-10-12：只对 Start Work Pending/Unknown 关闭终态缓存；理由是其余命令缺少等价 Host read-back 合同。

## Idempotence and Recovery

inFlight Promise 可重复合并；终态缓存可重复读取；Rejected Promise finally 清理。Controller 重启丢失内存 Map，Host ledger 负责跨重启恢复。无 schema/data repair。

## Interfaces and Dependencies

- #306 的 canonical request identity 与 `createReplayLog`。
- `CoreApi.commands.startWork`、`CommandWriteState`、`WritePhase`。
- Node test、TypeScript、workflow/rule-check scripts。

## Outcomes & Retrospective

待 Batch 3 填写实际结果、规模、遗留命令边界和验证证据。

## Bottom Change Note

- 2026-10-12：创建 #307 B2 ExecPlan，基于三份独立设计/审查确定 in-flight + terminal cache 与 Start Work live replay 边界。
