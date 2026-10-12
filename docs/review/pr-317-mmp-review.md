# PR #317 MMP 交付评审

- 评审对象：PR #317 `fix/controller-request-identity`
- 评审视角：MMP 交付闭环（代码、产品、架构、测试、反例、Issue/ExecPlan）
- 锁定时间：2026-10-12（Asia/Singapore）
- 锁定基线：`main` / `9a4ead3aa9682b0b51377c23b7dc92d27b5eba6a`
- 锁定 head：`dbe5968e045787ae88c8b1e5059f07a33c6576c3`
- PR 状态：ready（`isDraft=false`）、`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`
- 关联 Issue：`Closes #306`，`closingIssuesReferences=[#306]`
- 标签：`kind:fix`、`area:core`、`area:controller`、`area:tests`、`gate:R1`
- Milestone：`M2.1 · 发布前事实所有权收敛`
- 评审线程/旧评审：当前无 reviews、无 inline comments
- 评审账号：本次只读锁定和本地验证使用 `SingularityKChen`；未向 GitHub 写入 review

## 1. 目标、事实与边界

### 目标结果

同一 Controller 命令、同一幂等键必须绑定同一完整请求。actor、目标、payload 或外部引用改变时，在 Core/Provider mutation 之前返回结构化 `conflict`；完整请求重放复用首个结果；Start Work handoff 保留 actor id。

### 当前实现

- `packages/controller/src/commands.ts` 增加版本化、类型标记、键序稳定的 canonical 编码。
- replay entry 保存 `fingerprint`；同 key 的异 fingerprint 返回 `conflict`，不调用 Core。
- bootstrap/status/relation/rerun/startWork 纳入 actor、目标和 payload。
- `runStartWork` 传递 actor `kind` 与可选 `id`。
- `packages/core/src/execution-context.ts` 扩展 `StartWorkActor.id?`。
- 不改变 Storage schema、Host durable ledger 或 Provider 接口。
- #307（in-flight 合并、Pending/Unknown 生命周期）另由 PR #320/Issue #307 承接，属于当前明确边界。

### 不确定性与停止条件

Controller Map 仍是实例内 replay 优化；跨重启和在途语义没有被本 PR 声称或修复。该边界在 ExecPlan 与 PR 正文中已明确，不能把 #307 的缺口误判为 #317 的遗漏。

## 2. P0–P3 风险矩阵

| 严重度 | 代码 | 产品闭环 | 架构/事实所有权 | 测试/反例 | Issue/ExecPlan |
|---|---|---|---|---|---|
| P0 | 未发现合并即破坏 main 或硬约束的缺陷 | 未发现会造成不可逆数据/外部写入事故的缺陷 | 未发现 UI/Controller/Core/Provider 依赖边倒置或第二持久权威 | required checks 均通过 | #306 范围与实现闭合，#307 已明确分栈 |
| P1 | 未发现正常/失败路径会错误复用结果、吞错或越过 mutation 前身份门的缺陷 | 同键变 actor/目标/payload 的结果可观察为 conflict，且零 Core 调用；Start Work actor id 端到端 handoff 被断言 | Controller 私有 Map 未伪装为 Host durable ledger；Core 仍拥有 durable ledger | 关键反例通过；变异表 5/5 KILLED | 无阻塞级缺口 |
| P2 | 无当前实现缺陷；但 cross-command replay isolation 没有专门断言，依赖实现阅读 | #306 的“不同 command 不串结果”验收未用独立测试展示 | commandName 已进入 replay key/fingerprint，架构实现满足要求 | 未覆盖删去 commandName 或跨命令同 key 的变异 | 建议补一个跨命令隔离测试，避免未来 key 组装回归 |
| P3 | canonical 的键排序使用 JS 默认 UTF-16 `sort()`，ExecPlan 文字写的是码点序；当前公开 payload 字段均为固定 ASCII 名称，暂无实际 MMP 影响 | 无用户可见影响 | 不改变层边和事实拥有者 | 测试名声称含数组顺序差异，但实际只断言对象键序、undefined/null；数组场景未覆盖 | 建议在后续整理测试/规范时补齐，当前不阻塞 |

## 3. 分层检查证据

### 代码

- replay key 仍按 `commandName:idempotencyKey` 分区；缓存条目额外保存 fingerprint。
- fingerprint 计算在 run 前完成；编码失败返回结构化 `InvalidInput`，不调用 Core。
- 已有缓存且 fingerprint 不同返回 `Conflict`，`value=undefined`；正常重放返回原 result。
- `startWork` handoff 保留 actor id。
- canonical 对 primitive、undefined/null、数组、普通对象、循环引用和非普通对象有明确分支；当前 typed command payload 不含任意 provider 对象。

### 产品闭环

- 目标链路闭合：请求身份 → Controller 冲突判断 → Core mutation 门禁 → wire 结构化结果。
- 冲突不伪装成成功或复用首个 value；没有引入乐观 `saved`。
- 跨重启/在途不确定状态留给 Host ledger/#307，PR 正文和 ExecPlan 均未扩大承诺。
- Issue #306 仍为 OPEN（合并前正常）；PR 通过 `closingIssuesReferences=[#306]` 绑定，未发现另一个 issue 取代该 scope。#307 是相邻但独立的 live replay scope。

### 架构边界

- 改动仅落在 controller、core request type、controller E2E 与 ExecPlan。
- `pnpm run boundaries` 通过；未发现 ui→provider 或 controller→storage 的反向依赖。
- 没有 Storage schema、Provider 或公共 wire contract 变更。

### 测试与反例

本地在 PR worktree `.worktrees/fix-controller-request-identity` 执行：

- `node --test tests/e2e/controller-roundtrip.test.js tests/integration/start-work-retry-identity.test.js`：21 tests passed。
- `pnpm run typecheck`：通过。
- `pnpm test`：完整 contract/integration/e2e 通过（最终摘要为全绿；命令输出包含仓库全量测试）。
- `pnpm run boundaries`：8 tests passed。
- `node scripts/workflow-check.mjs`：no findings。
- `node scripts/rule-checks.mjs size origin/main`：代码 155/1000、文档 178/1500，通过。
- `node scripts/rule-checks.mjs disclosure origin/main`：机械扫描通过。
- `git diff --check origin/main...HEAD`：通过。
- 变异表（`scripts/review-mutate.mjs`，针对最终树）：删除 actor fingerprint、删除 request fingerprint、删除 conflict guard、删除 actor id handoff、删除 key sorting 共 5 个变异，全部 `KILLED`；变异后文件按字节还原且还原后基线全绿。

### 反例观察

- 已覆盖：actor、目标、status/payload、relation ref、pipeline ref、Start Work actor+repository；同键异请求不再调用 Core。
- 已覆盖：对象键重排不改变身份；undefined 与 null 有不同身份。
- 初轮未专门覆盖：跨 command 同 key 隔离、数组顺序差异；这两项已在修复批次补上，并用定向 mutation 验证测试判别力。

## 4. Issue / ExecPlan 验收

Issue #306 的 acceptance 与当前实现对照：

1. 同 key 不同 actor/target/payload → 已有 table-driven E2E，且 Core call count 保持 1。
2. 同完整请求 replay → 既有 replay E2E 通过。
3. bootstrap/status/relation/rerun/startWork 不串身份 → 各命令均有变参反例；跨命令隔离已有独立正向测试。
4. deterministic/collision-safe encoding → 实现覆盖 typed payload 的 primitive/object/array/循环/原型边界；数组顺序已有反例，变异忽略数组顺序时被测试杀死。
5. Start Work actor 保留 → counted Core spy 断言 id=a-1。
6. 不越过 Host ledger → 无 Storage/schema 变更；#307 明确另行承接。

PR body、ExecPlan、Issue scope 和当前 closing reference 一致。未发现同一问题由别的 issue 重复承接；#194/#204 是已有 Host/Core durable ledger 关联，#307 是明确的下一栈 live replay。

## 5. 结论与后续建议

**结论：无 P0/P1；建议 APPROVE。**

当前 head 在 MMP 视角下构成可独立验收、合并和回滚的 Controller request identity 闭环。建议把 P2/P3 作为后续修复：

- 补 cross-command 同 key 隔离的独立测试；
- 补数组顺序/码点排序的判别性测试，或把规范文字统一为当前固定字段实际需要的排序语义。

评审意见已由 `Singularity-AI-Bot` 在同一 consolidated review 中提交并回读确认；初轮结论为 APPROVE，非阻塞意见已进入修复批次。

## 6. 修复复评（2026-10-12）

- 补充 `相同幂等键在不同 command 之间隔离 replay 结果`，证明 command 分区不会串结果；删除 replay key 的 `commandName` 后该测试失败，`review-mutate.mjs` 判定为 `KILLED`。
- 补充 `canonical identity 保留数组顺序差异`；把数组排序后该测试失败，`review-mutate.mjs` 判定为 `KILLED`。
- ExecPlan 将“按码点序排序”改为与实际实现一致的 JavaScript 默认字符串序，避免文档与实现不一致；没有扩大公共 API、Storage schema 或 Host ledger 边界。
- 复评时需以修复后的新 head 重新锁定 base/head/checks/reviews/threads；#307、#194、#204 仍由既有 issue 和后续批次承接。
