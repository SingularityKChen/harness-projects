# Delivery 跨 owner 提交读栅栏 ExecPlan

> 状态：Active（源码独立复评通过；正在同步最新父层并等待最终远端门）；创建：2026-10-30（Asia/Singapore）。
> 范围：修复 #469 复审发现的跨 owner Delivery 拒读返回窗口；基于 `fix/delivery-runtime-access` 形成独立 stacked PR，完成后关闭 #468。
> 关联：Closes #468；Refs #469、#457。

## Purpose / Big Picture

当两个正常 Host/Core owner 共享同一 SQLite 工作区时，较早 owner 的 Delivery 读在最终返回前必须观察到另一 owner 已提交的拒读。旧 pipeline/check 标签和外部定位不得因为本地 epoch 未变化而外发；普通离线缓存、按 key/repository/work-item 隔离、纯查询和 Storage 事务边界保持不变。

## Context and Orientation

基础实现位于 `fix/delivery-runtime-access`：`packages/core/src/runtime-access.ts` 将 Delivery 读健康持久在既有 `SyncCursor`，`packages/core/src/delivery.ts` 和 `apps/harness-plugin/src/host-composition.ts` 在本 owner 内做版本 fence。独立复审的Core跨owner与真实Host返回探针 证明：A 的最终可见性检查被挂起时，B 已提交 pipeline 拒读，A 仍返回 2 个旧 pipeline 节点；下一次读取才变为 0。

## Design / Spec

设计候选：

1. 为 Storage 增加已提交读版本 token。SQLite 在同一连接上比较 `PRAGMA data_version`，并叠加本连接提交代次；Memory 在成功提交后增加等价代次。读取事务、rollback 和 close 语义必须保持不变；token 只用于同一 root owner 的前后比较，不能跨连接比较裸 `data_version` 数值。
2. 在最终返回前再次定向读取所有 Delivery health cursor 并重新 mask。该方案会打开新的读窗口，且必须解决同一连接 snapshot、事务队列和跨 owner 读的一致性，复杂度高于共享 token。

首选方案是候选 1：把 Storage 的已提交版本作为共享 authority 变化信号，最终 Host fence 在旧投影即将返回前比较 token；变化则重新读纯本地投影。不得创建第二权限数据库、请求队列或 UI 补偿。若真实实现无法在本仓库 Storage 语义内证明 rollback/close/跨 owner，回退到候选 2 并重新评估是否应继续拆分。

## Global Constraints

本切片文件集：`packages/capabilities/src/storage.ts`、`packages/capabilities/src/registry.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/src/storage.ts`、`packages/core/src/runtime-access.ts`、`packages/core/src/queries.ts`、`packages/core/src/delivery.ts`、`tests/integration/delivery-read-fence.test.js`、`tests/integration/delivery-cross-owner-return.test.js`、`tests/integration/planning-snapshot.test.js`、`tests/e2e/status-policy.test.js`、本计划及`docs/README.md`。

- 基础变更以 `fix/delivery-runtime-access` 为父层；本 PR 仅增加跨 owner committed-read fence 与判别测试。
- 代码/测试/config/fixture 增删严格小于 800 行，文档严格小于 1300 行；不删既有 Delivery 健康、scope、ABA 或负控验收。
- `packages/capabilities`、`packages/storage/sqlite`、`packages/providers/fake`、`packages/core`、`apps/harness-plugin` 的接口变化必须 Memory/SQLite 同语义；不做迁移、删除或旧发布兼容层。
- 本计划及正式证据中文；命令与代码标识英文；只写仓库相对路径。

## Plan of Work

### Concrete Steps

- [ ] 运行两份跨 owner RED 探针并记录 Memory/SQLite 与 Host 结果。
- [ ] 实现 token、接入 Core/Host fence，逐批运行判别测试。


### Batch 1 · RED 与方案锁定

在新工作树复现两份跨 owner 探针；新增最小正式测试，先证明旧返回含受保护 pipeline，再锁定 token 需求。记录 Memory/SQLite、Host/SQLite 及 rollback/close 边界。

### Batch 2 · committed-read fence

先实现 Storage token 的最小契约，再接 Core/Host 最终返回 fence。每个变更先跑对应红测，避免把本地 epoch 或下一次 UI refresh 当共享 authority。

### Batch 3 · 对抗验证与规模

在检出`fix/delivery-read-fence`的工作树根运行：

    pnpm test:file tests/integration/delivery-cross-owner-return.test.js tests/integration/delivery-read-fence.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js
    pnpm verify
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure fix/delivery-runtime-access
    node scripts/rule-checks.mjs size fix/delivery-runtime-access
    git diff --check fix/delivery-runtime-access...HEAD

期望三项Core/Host跨owner原反例与12项Storage fence全部通过，完整主套件/MVP0无失败，code<800/docs<1300，publication和diff无命中。

复跑原探针、同 owner late success/denial、offline/cache、scope/ABA、事务 rollback/close、Host 返回窗口；执行 `pnpm typecheck`、相关测试、`pnpm verify`（必要时在组合工作树）及 size/disclosure 检查。

### Batch 4 · PR 与交付

创建 Draft stacked PR，`Closes #468`、`Refs #469/#457`，填写 Project ExecPlan/Batch 等机械字段；整理 Conventional Commits，精确 lease 推送，回读 head/base/checks/closing associations/review threads；独立复核通过后置 Ready。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 跨 owner 返回 | A 被挂起、B 已提交拒读时，A 返回 0 pipeline/check 受限节点 |
| 普通能力 | offline 仍保留 stale cache；其它 key/repository/work-item 不受影响 |
| 事务语义 | commit 改变 token，rollback 不改变；close/重开不泄漏半写状态 |
| 同 owner 竞态 | 旧成功/拒读、最终 local fence 和 ABA 既有用例继续通过 |
| 规模与边界 | code/test/config <800，docs <1300；无迁移/删除；required checks pass |

## Progress

- [x] Batch 1 RED 与候选方案
- [x] Batch 2 实现 committed-read fence
- [x] 2026-10-30：Batch 3 原P1及F1–F4独立复评通过；源码完整verify2704+7通过，最新父层组合另行回读。
- [ ] Batch 4 Draft/Ready 与远端回读

## Surprises & Discoveries

- 当前本 owner epoch 无法观察另一个 owner 已提交的拒读；该结论由 Memory/SQLite 与真实 Host 探针一致复现。
- SQLite `PRAGMA data_version` 只适合同一连接前后比较；跨连接裸值不可直接比较，必须叠加本连接提交代次。

## Decision Log

- Decision：将共享返回 fence 从 #469 拆为独立 stacked PR。
  Rationale：预计在 #469 738 行基础上增加约 145 行，超过 800 行门禁；删除既有健康协议或 race 测试会削弱验收。
  Date/Author：2026-10-30（Asia/Singapore）/ 协调者。

## Idempotence and Recovery

Storage token 读取只读、可重复；事务 rollback 不推进 token；失败后恢复到 `fix/delivery-runtime-access`。推送前创建 backup ref；不删除用户库或外部资源。

## Interfaces and Dependencies

遵循根 `PLANS.md`；依赖 #469 的 SyncCursor 健康协议、Memory/SQLite Storage、Core Delivery projection 与 Host final scope fence。使用仓库指定pnpm 10.28.2。本地 fake Provider 与临时 SQLite 不代表真实账号权限或人类 UAT。

## Artifacts and Notes

运行态探针和日志只保存在 `.superpowers/` 与 `任务临时证据目录`；正式结论回写本计划。

## Outcomes & Retrospective

源码验收head `6e2da2f10c695fcd76b8065b5289e41931b18f0b`：原Core Memory/SQLite和真实双Host探针均返回受限节点0；fence12/12、聚焦含contract1315/1315、boundaries9/9、完整verify2704/2704与MVP0 7/7。独立复评F1–F4全部ADDRESSED。最新父层更新后正在重新验证；产品通过不代替新head远端门、人类UAT或R1。

## Bottom Change Note

Change Note (2026-10-30 SGT)：新建 stacked PR 计划；因 #469 P1 跨 owner 返回窗口超出其代码预算而拆分。

Change Note (2026-10-30 SGT)：补修 StorageTransaction 不暴露 committedReadFence 的类型契约；SQLite close 后 fence 以 CLOSED_MESSAGE 快速失败；新增 SQLite close 与 Memory 双 Core 共享代次判别测试。RED 先命中 `database is not open`，GREEN 为 fence 5/5、Delivery/Host 36/36、tsc 通过；未改 PR metadata、未推送。

Change Note (2026-10-30 SGT)：独立复评补 F1/F2/F3：SQLite atomic direct SQL 成功推进 local commit generation；普通 read transaction 不推进；SQLite/Memory root fence 仅在同一 transaction callback 的 AsyncLocalStorage scope 内拒绝；queries committedFence 对非 string 改为结构化抛错，移除 fail-open。RED 命中 atomic fence 不变、root guard 缺失和 Promise wrapper 语义；GREEN fence 8/8、planning 3/3、status 26/26、Delivery+Host 36/36、Storage contract+boundaries 167/167、tsc 通过。未 commit/push。

Change Note (2026-10-30 SGT)：F4 修复 settled async callback 误拒：SQLite/Memory transaction scope 改为 `{ owner, active }`，finally 清 active；补 commit/rollback delayed setImmediate fence 测试。RED 4/4，GREEN fence 12/12、Delivery+Host 36/36、planning 3/3、status 26/26、tsc 通过。未 commit/push。

Change Note (2026-10-30 SGT)：修正前次仅移动计划但未保存头部状态的归档记录错误；按真实源码/父层状态暂留Active，最终源代码验证和远端门完成后归档。

Change Note (2026-10-30 SGT)：把原Memory/SQLite与双Host返回探针升级为3项正式回归，隔离旧base3/3有效RED，当前15项新验收全GREEN；复用runtime-access leaf承载fence校验，移除queries↔delivery模块循环，测试临时库按mkdtemp清理。
