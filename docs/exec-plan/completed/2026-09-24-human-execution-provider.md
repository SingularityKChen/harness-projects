# 2026-09-24-human-execution-provider —— 可绑定的人工执行 provider、降级承接与运行身份

> 状态：Completed（随 PR #161 归档；#139 / #171 / #172 的关闭由人类伙伴决定，见 `Outcomes & Retrospective`）
> 创建：2026-09-24；本文件于 2026-09-28 重建（见 `Surprises & Discoveries` S1）
> 范围：实现 `packages/providers/execution-human`；让 core 在主执行起不来时启动声明了 `execution.run.fallback` 的绑定；把运行的 provider 引用与"由降级产生"落进 Storage；给 core 一个按运行身份取消的命令。**不在范围内**：宿主 / 应用装配（#132）、UI 入口（#142）、SQLite 上的 Start Work 前置（#187 / #188 / #196）、工作树句柄统一（#206）
> 上游输入：issue #139（本层闭环）、#171（降级触发点）、#172（运行身份落库）、#136（父 epic）；`docs/product/vertical-path.md` §2 步骤 6–8；`AGENTS.md` §1.1、§2；`docs/adr/ADR-0008-run-identity-is-the-core-run-record.md`

## Purpose / Big Picture

完成后：**人工执行是一次处于 `running` 的运行**，由人推进、不由进程推进。把人工 provider 绑成主执行绑定时，`startWork` 直接得到它；把它以 `fallback: true` 绑成降级绑定时，主执行起不来之后 core 启动它，上下文、工作树与分支都保留，结论是 `manual_fallback`。运行记录带着人工 provider 签发的引用（`providerRef`）与"由降级产生"（`fallback`），所以重启后查询面、同键重放与取消都读得到同一个事实；取消按运行身份收敛，一个运行身份只落一个 canceled 事实。

**闭环的层级**：以上都是**库级**闭环。全仓非测试代码里没有任何地方 import 本包或 `provider-development-local-git`（回读：`grep -rln "execution-human\|development-local-git" apps packages/controller packages/client packages/ui` 期望无输出），宿主组合根是 #132、UI 入口是 #142；换成 SQLite 作 Storage 时 core 侧 Start Work 还受 #187 / #188 / #196 阻塞。合并后用户可观察的变化为零。

最小成功证据（在检出 `feat/human-execution-provider` 的工作树根目录运行，head 回读：`gh pr view 161 -R SingularityKChen/harness-projects --json headRefOid`）：

1. `node --test tests/contract/execution-contract.test.js`：人工 provider 适配器块无网络通过 Execution 契约套件，加判别性用例；
2. `node --test tests/integration/human-execution-provider.test.js`：真实本地 Git + 人工执行 + 离线 Storage 的 8 条端到端用例；
3. `node --test tests/contract/storage-contract.test.js`：内存替身与 SQLite 都逐字段往返 `providerRef` 与 `fallback`；
4. 变异实验 M1–M37 中除 M35 外每条先红、还原后绿，M35 存活并登记 #215（`Surprises & Discoveries` 的「最终复测」表）。

## Context and Orientation

### 术语

| 词 | 在本计划里的意思 |
|---|---|
| 执行上下文 | `ExecutionContextRecord`：工作项 + 仓库 → 工作树 + 分支。core 写，provider 不碰 |
| 运行 / 运行身份 | `ExecutionRunRecord`，键 `runIdFor(contextId)`。它就是运行身份（ADR-0008）；core 是唯一写者 |
| `providerRef` | 执行 provider 签发的运行引用，落在运行记录上，是重启后路由 `getRun` / `cancelRun` 的唯一依据 |
| 签发者 | 签出引用的那个 provider 实例：`bindingId` + `issuerKey`，由宿主注入，重启前后不变 |
| 降级 | `StartWorkFallback.Manual`（`manual_fallback`）：主执行没起来、这件事转人工。只从运行记录的 `fallback` 字段读出（D8 第十一轮订正：主执行 ack 的 `failed` 不是降级） |

### 相关文件（当前状态）

| 文件 | 作用 |
|---|---|
| `packages/providers/execution-human/src/index.ts` | 人工执行 provider：签名引用、来源闸门、往返校验、声明式故障面 |
| `packages/capabilities/src/execution-provider.ts` | Execution port；文件头写三条实现义务（能力先于身份、返回引用由 provider 构造、一次性输入不落库） |
| `packages/capabilities/src/storage.ts` | `ExecutionRunRecord.providerRef` / `fallback` |
| `packages/capabilities/src/capability-keys.ts` | `execution.run.fallback` |
| `packages/core/src/start-work.ts` | `manualFallback` 启动 fallback 绑定；`recordRun` 写 `providerRef` / `fallback` |
| `packages/core/src/execution-run.ts` | `cancelExecutionRun`：按运行身份取消，事务内原子替换 |
| `packages/core/src/execution-context.ts` | `fallbackOf`：降级结论只从运行记录读 |
| `packages/core/src/registry.ts` | `executionFallback` 注册为非默认执行绑定 |
| `packages/storage/sqlite/migrations/004_execution_run_identity.sql` | `provider_ref_json`、`fallback` 两列 |
| `tests/contract/suites/execution.js`、`tests/contract/suites/storage-execution.js` | 共享套件：能力先于身份；运行记录逐字段往返 |

## Design / Spec

- **D1 人工运行 = `running`，不新增枚举取值**：`ExecutionRunStatus` 里没有 `manual`；"由人做"由 `manual_fallback` 表达，再加取值会让同一事实有两个权威。
- **D2 provider 不写 Storage、无进程内状态**：`getRun(ref)` 是 ref 的纯函数；运行事实的唯一写者是 core。
- **D3 引用承载运行身份与来源**：`manual-run:<context>@<startedAt>[#canceled@<finishedAt>]~<HMAC>`，签名是 `HMAC-SHA256(issuerKey, bindingId + "\n" + 规范体)` 的 base64url。**第十一轮订正**：换行拼接不是单射（binding id 带换行时可拼出另一组输入），改为 `JSON.stringify([bindingId, 规范体])` 分帧。时刻必须严格 ISO 8601 往返；`startRun` / `cancelRun` 发出前都做往返校验并把失败归因到上下文 id 或时钟。
- **D4 来源闸门**：binding、objectKind、签名、规范体形态四项都对才是本签发者的运行；否则 `not_found`（fail closed）。放弃"形状闸门 + 如实钉住伪造可读"（第七至九轮 P2：同形伪造引用会被当成一条 `running` 运行，而引用落库后是重启路由的唯一依据）。
- **D5 签发者身份必须注入**：缺 `bindingId`、缺或短于 32 字节的 `issuerKey` 即 `TypeError`。放弃随机默认值——它把"重启后读不回"推迟到重启之后才暴露。
- **D6 取消的两层语义**：provider 层签发带结束时刻的新引用，对已带结束时刻的引用再取消是 `conflict`，同一原始引用可签出多个 canceled 引用（无状态的代价，用例如实钉住）；运行身份层由 core 的 `cancelExecutionRun` 收敛：已取消原样返回、不再调 provider；否则路由回签发者（路由不到就 `not_found`、不换 binding），ack 后在事务里复核仍是同一条 running 记录再原子替换状态与 `providerRef`。**第十一轮订正**：非终态（`queued` / `starting` / `unknown`）都可取消，只有 `succeeded` / `failed` / `timed_out` 是 `conflict`；事务内复核改为与读到的状态比较；provider 因并发取消已先生效而答 `conflict` 时，以事务内复读到的已取消记录为准。
- **D7 一次性输入不落库**：`command` / `environment` 不进引用、不进记录（`environment` 可能带凭据）；交接快照 = 执行上下文（工作项、仓库、分支、工作树）+ 运行引用 + 降级结论，经 `getExecutionContext` 暴露。
- **D8 降级结论落库**：`manualFallback` 写的运行带 `fallback: true`，读回路径用 `fallbackOf`，不再从 `failed` 反推——承接成功的人工运行是 `running`。**第十一轮订正**：Batch 4 的 `fallbackOf` 仍保留了 `|| status === failed` 这条反推（评审 P2），现改为只读 `fallback`；主执行 ack 的 `failed` 是运行失败、不是降级，首次结论与查询面一致。
- **D9 fallback 是能力，不是特例**：`execution.run.fallback` 由 provider 在快照里声明，core 只按能力键解析；fallback 绑定 ack 了 `running` 才落运行，否则落 `failed`。**第十一轮订正**（评审 P1）：执行域两个角色在注册时按能力键分开——主执行绑定去掉 `execution.run.fallback`，fallback 绑定去掉 `execution.run.start`；否则主执行 start 不可用时 fallback 被当成主执行选中、降级结论消失。fallback 启动走写门（`resolveWriteTarget(execution.run.fallback)`，只读即不启动）；主执行 `ambiguous_result` 时它可能已在跑，不启动 fallback（ADR-0007）；只注入 fallback 时也注册；两个绑定共用 binding id 时组装即拒绝。
- **D10 故障面是声明式只读配置**（冻结）：`offline`、`startUnavailable`；启动失败信息点名唯一阶段 `manual`。

## Global Constraints

- 代码改动 ≤1000 行、文档改动 ≤1500 行，按 `origin/main` 度量（`node scripts/rule-checks.mjs size origin/main`）；不新增第三方依赖、不改 `pnpm-lock.yaml`、不改 `packages/providers/fake/src/**`。
- `packages/providers/execution-human` 只 import `@harness-projects/capabilities`、`@harness-projects/domain` 与 Node 内置模块；`pnpm run boundaries` 全绿。
- 迁移在首发前可重写（004 未进 `main`），不写兼容层。
- 文档正文中文；代码标识符、路径、命令英文；不写凭据、账号、内网信息、本机绝对路径。
- **本计划改动的文件集合**：`packages/providers/execution-human/src/index.ts`；`packages/capabilities/src/{capability-keys,execution-provider,storage}.ts`；`packages/core/src/{context,execution-context,execution-run,index,registry,start-work}.ts`；`packages/storage/sqlite/migrations/004_execution_run_identity.sql`、`packages/storage/sqlite/src/{migrations,storage-execution,storage-rows}.ts`；`tests/contract/{execution-contract,capabilities-keys}.test.js`、`tests/contract/suites/{execution,storage-execution}.js`；`tests/integration/{human-execution-provider,execution-relation-write-schema}.test.js`、`tests/integration/README.md`；`docs/adr/ADR-0008-run-identity-is-the-core-run-record.md`、`docs/adr/README.md`；`docs/review/2026-09-26-pr-161-mmp-round7.md`、`docs/review/2026-09-28-pr-161-mmp-round8.md`；本文件与 `docs/README.md`。

## Plan of Work

### Batch 1 · 人工执行 provider 与契约装配（2026-09-24，已完成）

**涉及文件**：`packages/providers/execution-human/src/index.ts`、`tests/contract/execution-contract.test.js`。**最小闭环**：人工 provider 通过 Execution 契约套件。**验证**：`node --test tests/contract/execution-contract.test.js`，期望 `fail 0`。**回滚**：按提交逆序 revert，不能单独 revert `feat(providers)`（见 `Idempotence and Recovery`）。

### Batch 2 · 真实本地 Git 上的端到端用例（2026-09-24，已完成）

**涉及文件**：`tests/integration/human-execution-provider.test.js`、`tests/integration/README.md`。**最小闭环**：真实本地 Git + 人工执行 + 离线 Storage 上 `startWork` 落盘、降级保留、重启回读、接管重试（「接管重试」已在 Batch 5 删除，见 Decision Log）。**验证**：`node --test tests/integration/human-execution-provider.test.js`，期望 `fail 0`。**回滚**：revert `feat(execution)` 提交中的集成用例。

### Batch 3 · 降级承接与运行身份落库（第七至九轮，2026-09-26，已完成）

**涉及文件**：`packages/capabilities/src/{capability-keys,storage}.ts`、`packages/core/src/{registry,start-work,execution-context}.ts`、`packages/storage/sqlite/` 的 004 与行映射。**最小闭环**：`execution.run.fallback` + fallback 绑定；`providerRef` 进 Storage / SQLite 004；查询面与重放带回引用。**验证**：`node --test tests/contract tests/integration tests/e2e`，期望 `fail 0`。**回滚**：revert `feat(execution)` 提交。

### Batch 4 · 第十轮：四条 P2 的根因修复与丢失修复的恢复（2026-09-28，已完成）

**最小闭环**：D4–D8 落地；恢复 S1 丢失的 port 义务与共享套件断言。**涉及文件**：provider、`execution-run.ts`、`execution-context.ts`、`storage-rows.ts`、004、两份契约、集成用例。

- [x] 先写红的用例：来源闸门、签发者配置、一次性输入、按运行身份取消（含并发）、签发者变了 fail closed、交接快照与降级结论、Storage 往返
- [x] provider：必需签发者配置、HMAC 签名与来源闸门、取消从事实重建规范体
- [x] core：`cancelExecutionRun`；`fallbackOf`；`recordRun` 写 `fallback`
- [x] Storage：`fallback` 列；SQLite 读回按端口四元组重建 `providerRef`
- [x] port 义务 1–3 与共享套件断言（S1 恢复）；ADR-0008

**验证**（期望输出见 `Surprises & Discoveries` 的「第十轮验证输出」）：

```bash
./node_modules/.bin/tsc --noEmit
node --test tests/contract tests/integration tests/e2e
node --test tests/mvp0
npm_config_manage_package_manager_versions=false pnpm run boundaries
node scripts/rule-checks.mjs size origin/main
node scripts/rule-checks.mjs disclosure origin/main
git diff --check origin/main...HEAD
```

**回滚**：见 `Idempotence and Recovery`。

### Batch 6 · 第十二轮复评响应（2026-09-28，已完成）

**最小闭环**：复评（review `5337168829`，锚定 `d684777`）确认 P1 与 9 条 P2 已修复；新 P2（接管终态上下文时 `manualFallback` 覆盖已有运行、起第二个执行者）与 3 条 P3、4 处残留在本 PR 内修复。**涉及文件**：`packages/core/src/start-work.ts`、004、provider、共享套件、集成 / 契约 / schema 用例、本文件、`tests/integration/README.md`。

- [x] `manualFallback` 开头先读已有运行，存在就原样返回、不覆盖、不承接（M31）
- [x] 补主执行也声明 fallback、start 被设为只读（`permission_denied`）两行（M28、M29），以及已结束运行拒绝取消（M30）
- [x] `provider_ref_json` 只接受 JSON 对象（M32）；`null` 引用结构化失败（M33）；取消返回的引用不回显（M34，共享套件）
- [x] 本文件六处过期原句改为当前事实；变异表合并为最终复测表
- [x] 第十三轮最终复核（review `5337401664`）的 P3：上面那条早返回改为按已有运行记录报出 `fallback` 与 `runExternalId`（M36、M37），接管场景挪进 fallback 承接用例，使引用与降级结论两半都有断言；`startExecution` 在 start 门开着时的同类早返回是 `main` 既有行为，仍归 #215 验收第 4 条

### Batch 5 · 第十一轮评审响应（2026-09-28，已完成）

**最小闭环**：第十一轮评审（review `5336742672`，锚定 `9274b3d`，1 P1 / 9 P2 / 13 P3）的 P1 与全部 P2 在本 PR 内按根因修复，可机械修的 P3 顺手修，其余登记 #215。**涉及文件**：`packages/core/src/{registry,start-work,execution-context,execution-run}.ts`、provider、`packages/storage/sqlite/migrations/004_execution_run_identity.sql`、共享套件、两份契约 / 集成用例与 schema 用例。

- [x] D9 订正：角色分离、写门、结果不确定不承接、重复 binding id 拒绝、只注入 fallback 也注册
- [x] D6 订正：非终态可取消、并发 conflict 以记录为准；D8 订正：`fallbackOf` 只读 `fallback`
- [x] port 义务 2、3 进共享套件；`startRun` 的外来上下文与坏时钟、畸形 `externalId`、`#canceled` 归因补断言；HMAC 改 JSON 分帧；004 加 `json_valid`
- [x] 删除与 `main` 上 `local-git-core-provisioning`「恢复供应」同路径同不变量的「接管重试」用例（#209 合入后重复），腾出行数
- [x] 第七、八轮评审记录就地标注 Superseded；回滚顺序订正；README 只写集成用例真正断言的内容

**验证**：同 Batch 4 的命令；变异 M12–M27 见 `Surprises & Discoveries`。**回滚**：见 `Idempotence and Recovery`。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 人工运行是 `running`，无 `finishedAt` / `exitCode` / `logUrl`，不新增枚举取值 | 契约「startRun 标记的是一次由人推进的 running 运行」；`tests/contract/domain-enums.test.js` |
| 2 | 来源闸门：未签、改过字段、自加取消标记、换密钥、别的 binding 签出的同形引用对 `getRun` / `cancelRun` 都 `not_found` | 契约「身份闸门是**来源闸门**」；M1、M2 |
| 3 | 签发者配置缺失即拒绝构造 | 契约「签发者配置缺失即拒绝构造」；M3 |
| 4 | `command` / `environment` 不进任何返回值 | 契约「command / environment 是一次性输入」；M4 |
| 5 | 能力先于身份（port 义务 1），两份适配器都满足 | 共享套件「缺可选取消能力报 unavailable」；M5 |
| 6 | 按运行身份取消：并发取消返回同一事实、已取消不再调 provider、重启后仍同一事实、查询面读到替换后的引用 | 集成「取消以运行身份为准」；M6、M7 |
| 7 | 签发者配置在重启后变了：取消 `not_found`、记录不变；binding 变了时不问任何 provider | 集成「重启后签发者配置变了」；M8 |
| 8 | fallback 承接：`running` 人工运行；重启与同键重放后交接快照与 `manual_fallback` 不变 | 集成「主执行起不来、fallback 绑定承接」；M9 |
| 9 | 两个 Storage 实现逐字段往返 `providerRef`（含 `url: undefined`）与 `fallback` | 共享执行组「同一工作项+仓库最多一个 active 执行上下文」；M10、M11 |
| 10 | 执行起不来且无 fallback：上下文 `ready`、工作树与分支在磁盘上（按总数）、运行 `failed` | 集成「执行起不来且没有 fallback 绑定」 |
| 11 | 重启后执行上下文、运行记录、人工引用逐字段不变，不重复供应 | 集成「重启」 |
| 12 | fallback 只当 fallback：主执行 start 无权限时不被当成主执行；主执行结果不确定不承接；fallback 只读不承接；fallback ack 非 running 不落；主执行 ack failed 不算降级；首次结论与查询面一致 | 集成「fallback 只在主执行**确定**起不来时承接」；M12–M15、M26 |
| 13 | port 义务 2、3 对两份适配器都成立 | 共享套件「启动后可读回同一运行」；M24、M25 |
| 14 | 取消：`queued` 可取消；有状态 provider 并发取消收敛；只读策略下 `permission_denied` 且不调 provider；binding id 重复即拒绝组装；只注入 fallback 也承接 | 集成「取消：queued 不是终态……」与「重启后取消 fail closed」；M16–M19、M27 |
| 15 | `provider_ref_json` 必须是 JSON 对象（拒 `null` / 数组 / 坏 JSON），`fallback` 只能是 0 / 1 | `tests/integration/execution-relation-write-schema.test.js`；M20、M32 |
| 16 | 接管终态上下文时已有运行：不覆盖、不承接，首次结果按这条记录报出引用与降级结论；主执行也声明 fallback 或 start 只读时承接的是 fallback 绑定；已结束的运行拒绝取消且不调 provider | 集成「主执行起不来、fallback 绑定承接」末段、「fallback 只在主执行**确定**起不来时承接」、「取消：queued 不是终态……」；M28–M31、M36、M37 |

## Progress

- [x] 2026-09-24 Batch 1、Batch 2；第一至四轮评审响应
- [x] 2026-09-26 第六轮 7 条处置（含 port 义务 1–2 与共享套件断言）；Batch 3（第七轮两条 P1 的跨层修复）
- [x] 2026-09-28 第八、九轮复评：无 P0 / P1，四条 P2 未 resolve
- [x] 2026-09-28 Batch 4：四条 P2 根因修复、S1 恢复、S3 修复、ADR-0008；全量验证见下
- [x] 2026-09-28 第十一轮评审（1 P1 / 9 P2 / 13 P3）；Batch 5 修复 P1 与全部 P2、可机械修的 P3，余项登记 #215
- [x] 2026-09-28 第十二轮复评（P0 / P1 清零；新 1 P2 / 3 P3 与 4 处残留）；Batch 6 修复，M35 与 `isDefault` 断言补进 #215
- [x] 2026-09-28 第十三轮最终复核（8 项全部修复；新 1 P3）；同批修复

## Surprises & Discoveries

### S1 · ExecPlan 与第六轮的一处修复在 09-26 的重排里从分支上丢失（2026-09-28）

PR 描述链接的 `docs/exec-plan/active/2026-09-24-human-execution-provider.md` 在 head `0296551` 上不存在；`packages/capabilities/src/execution-provider.ts` 的两条实现义务注释与 `tests/contract/suites/execution.js` 的「能力先于身份」断言也不在——而 PR 描述仍声称它们已交付。回读：`git ls-tree -r --name-only <head> | grep human-execution`；对历史 head 逐个比对可见它们在 `7431dfc`（有）与 `93a92d5`（无）之间消失，同期还有一次 head 只剩 `docs(review)` 提交。本批次把两处代码按原意恢复（义务新增第 3 条），计划按当前事实重建为本文件，第一至六轮的逐条处置收敛进 `Decision Log`，第七、八轮评审记录保留在 `docs/review/`。

### S2 · SQLite 的 JSON 往返把 `url: undefined` 变成"没有这个键"（2026-09-28）

新增的执行组往返断言在内存替身上绿、在 SQLite 上红（`deepEqual` 的键集合不同）。`rowToExecutionRun` 改为按端口四元组显式重建。M11 证明断言有牙。

### S3 · fallback 承接后，查询面与同键重放报"未降级"（2026-09-28，本 PR 引入）

在 head `0296551` 的一次性检出（独立 `pnpm install --frozen-lockfile --offline`）上实测，主执行 `startUnavailable` + fallback 人工绑定：

```text
RESULT {"first":["manual_fallback",true],"replay":[null,false],"view":[null,false]}
```

首次 `startWork` 报 `manual_fallback / degraded`，同键重放与 `getExecutionContext` 报 `undefined / false`：读回路径只从 `status === failed` 反推降级，而承接成功的人工运行是 `running`。`main` 上没有这条路径，属本 PR 引入；它也是第四条 P2（交接快照可见性）的同一根因——交接事实必须落库，不能反推。按 D8 修复，M9 证明断言有牙。

### S4 · 代码规模逼近上限（2026-09-28）

修复落地后工作区代码一度到 1115 / 1000。压缩方式是把集成用例里重复的磁盘取证收成 `assertOnDisk`（同时把"过滤后比较"改成按总数断言，更严）、合并两条重叠的 provider 取消用例、删掉复述性注释；没有删除任何断言的内容。

### S5 · fallback 绑定在主执行 start 不可用时被当成主执行（第十一轮 P1，本 PR 引入）

两条独立评审线各自复现：替身主执行 `permissionDenied` + 人工 fallback 绑定时 `{"fallback":null,"degraded":false}`、运行指向 fallback 绑定且不带 `fallback`；去掉 fallback 绑定则是 `manual_fallback / degraded:true`；base `547b2de` 报 `degraded:true`，`0296551` 与 `9274b3d` 相同。根因：人工 provider 以 fallback 身份也声明 `execution.run.start`，而 start 的解析取第一个可用绑定。按 D9 订正修复。同一轮还发现 5 个未列出的存活变异体（见下表 M15、M16、M22、M24、M25 对应的缺口），以及本轮自测时 M23、M26 存活，均已补断言。

### 变异实验（最终复测：在最终 head 的工作树上逐条跑，先确认变异已应用、跑完逐字节还原）

第十、十一轮在中间工作区测得的读数已被本表取代（例如 M12 当时是 `7 / 1`，加上「只注入 fallback」用例后是 `6 / 2`——第十二轮复评指出；接管场景挪进 fallback 承接用例后是 `5 / 3`）。

| # | 变异 | 跑的用例 | 结果 |
|---|---|---|---|
| M1 | 来源闸门不验签 | `execution-contract` | `pass 27 / fail 1` |
| M2 | 签名输入不含 `bindingId` | 同上 | `pass 26 / fail 2` |
| M3 | 缺 `bindingId` 不拒绝构造 | 同上 | `pass 27 / fail 1` |
| M4 | `command` 编进引用 | 同上 | `pass 24 / fail 4` |
| M5 | `cancelRun` 先判身份再判能力 | 同上 | `pass 27 / fail 1` |
| M6 | 已取消仍调 provider | `human-execution-provider` | `pass 7 / fail 1` |
| M7 | 事务内不复核就覆盖 | 同上 | `pass 7 / fail 1` |
| M8 | 路由不到签发者就换一个执行 binding | 同上 | `pass 7 / fail 1` |
| M9 | 降级结论不读 `fallback` 字段 | 同上 | `pass 5 / fail 3` |
| M10 | SQLite 读回丢 `fallback` | `storage-contract` | `pass 120 / fail 1` |
| M11 | SQLite 读回不重建四元组 | 同上 | `pass 120 / fail 1` |
| M12 | fallback 绑定不去掉 `start` | `human-execution-provider` | `pass 5 / fail 3` |
| M13 | 结果不确定仍起 fallback | 同上 | `pass 7 / fail 1` |
| M14 | fallback 不走写门 | 同上 | `pass 7 / fail 1` |
| M15 | fallback 任意 ok 都落库 | 同上 | `pass 7 / fail 1` |
| M16 | 取消不查只读 | 同上 | `pass 7 / fail 1` |
| M17 | `queued` 当成已结束 | 同上 | `pass 7 / fail 1` |
| M18 | provider 答 conflict 时不以记录为准 | 同上 | `pass 7 / fail 1` |
| M19 | 不拒绝重复 binding id | 同上 | `pass 7 / fail 1` |
| M20 | 去掉 `provider_ref_json` 约束 | `execution-relation-write-schema` | `pass 11 / fail 1` |
| M21 | 闸门不守 `externalId` 类型 | `execution-contract` | `pass 27 / fail 1` |
| M22 | `startRun` 不查 binding | 同上 | `pass 27 / fail 1` |
| M23 | 保留标记只查 `#canceled@` | 同上 | `pass 27 / fail 1` |
| M24 | 替身 `getRun` 回显调用方引用 | 同上 | `pass 27 / fail 1` |
| M25 | 替身把 `environment` 编进引用 | 同上 | `pass 27 / fail 1` |
| M26 | 降级结论重新从 `failed` 反推 | `human-execution-provider` | `pass 7 / fail 1` |
| M27 | 只注入 fallback 时不注册 | 同上 | `pass 7 / fail 1` |
| M28 | 主执行保留 `fallback` 键 | 同上 | `pass 7 / fail 1` |
| M29 | 主执行 `permission_denied` 时不承接 | 同上 | `pass 7 / fail 1` |
| M30 | 已结束的运行仍去取消 | 同上 | `pass 7 / fail 1` |
| M31 | 接管时覆盖已有运行 | 同上 | `pass 7 / fail 1` |
| M32 | `provider_ref_json` 只查 `json_valid` | `execution-relation-write-schema` | `pass 11 / fail 1` |
| M33 | 闸门不守 `null` 引用 | `execution-contract` | `pass 27 / fail 1` |
| M34 | 替身 `cancelRun` 回显调用方引用 | 同上 | `pass 27 / fail 1` |
| M35 | 事务内不复核引用（取消途中记录被换成同状态不同引用） | `human-execution-provider` | `pass 8 / fail 0`，**存活**；该场景需要注入并发写，与 #215「只在 ack canceled 时替换」一起补 |
| M36 | 已有运行的早返回只报 git 结果 | 同上 | `pass 7 / fail 1` |
| M37 | 已有运行的早返回不带降级结论 | 同上 | `pass 7 / fail 1` |

### 第十轮验证输出（2026-09-28，提交前的工作区）

| 命令 | 输出 |
|---|---|
| `./node_modules/.bin/tsc --noEmit` | 无输出，exit 0 |
| `node --test tests/contract tests/integration tests/e2e` | `tests 756 / pass 756 / fail 0` |
| `node --test tests/mvp0` | `tests 7 / pass 7 / fail 0` |
| `pnpm run boundaries` | `tests 7 / pass 7 / fail 0` |
| `node --test tests/contract/execution-contract.test.js` | `tests 28 / pass 28 / fail 0` |
| `node --test tests/integration/human-execution-provider.test.js` | `tests 7 / pass 7 / fail 0` |
| `node --test tests/contract/storage-contract.test.js` | `tests 121 / pass 121 / fail 0` |

第十一轮（Batch 5）与第十二轮（Batch 6）提交前的工作区：全量 `tests 757 / pass 757 / fail 0`，mvp0 与 boundaries 各 `7 / 7`，`execution-contract` `28 / 28`，`human-execution-provider` `8 / 8`，schema `12 / 12`，`storage-contract` `121 / 121`。提交后的规模、披露扫描与 CI 一律回读：`node scripts/rule-checks.mjs size origin/main`（期望代码 ≤1000、文档 ≤1500）、`gh pr checks 161 -R SingularityKChen/harness-projects`（期望全部 pass）。

## Decision Log

| 日期 | 决策 | Rationale |
|---|---|---|
| 2026-09-24 | D1、D2、D10；`harnessFailure` 映射到 `startUnavailable` | 不造第二个权威；故障名与语义对齐（第一轮 P2-6） |
| 2026-09-24 | 往返校验并按成因归因；严格 ISO 8601 | 第一至三轮：`ctx-a#canceled@b`、坏时钟、`Date.parse` 放过非时刻 |
| 2026-09-26 | port 义务 1、2 写进 port、断言进共享套件（第六轮 P3，就地放宽"不改 capabilities / 套件"为"只允许增强"） | 义务是 port 级的；替身实测已满足 |
| 2026-09-26 | 第七轮两条 P1 在本 PR 内跨层修复：`execution.run.fallback` + fallback 绑定（#171 的选项 1 变体）；`providerRef` 进 Storage / SQLite 004（#172） | 评审判定不修则 #139 验收 2 与 epic 降级验收都不成立 |
| 2026-09-28 | D4 来源闸门取代形状闸门 | 引用落库后是重启路由的唯一依据，形状闸门让同形伪造可读（第七至九轮 P2） |
| 2026-09-28 | D5 签发者配置必需、fail closed | 随机默认值把配置错误推迟到重启之后（第七至九轮 P2） |
| 2026-09-28 | D6 运行身份级取消归 core | 无状态 provider 无法收敛；provider 自带账本会造出第二个写者（第七至九轮 P2） |
| 2026-09-28 | D7 一次性输入不落库，写进 port 义务 3 | `environment` 可能带凭据；指令事实已在执行上下文（第七至九轮 P2） |
| 2026-09-28 | D8 降级结论落库（S3） | 与 D7 同根：交接事实必须落库而不是反推 |
| 2026-09-28 | 写 ADR-0008 | #172 明确要求：运行记录新增由 provider 签发的字段，属跨层契约决策 |
| 2026-09-28 | 保持 `Refs #139 / #171 / #172`，不改成 `Closes` | 关闭引用的变化是对外承诺；证据已具备，由人类伙伴决定是否关闭 |
| 2026-09-28 | 执行域主执行 / fallback 按能力键分角色（D9 订正） | 第十一轮 P1：同一能力键集合表达两个角色，start 解析会把 fallback 当主执行 |
| 2026-09-28 | fallback 只受 `execution.run.fallback` 的写门约束，不看 `execution.run.start` 的策略 | 两个角色各有自己的键；要关掉降级承接，把 `execution.run.fallback` 设为 `unavailable` |
| 2026-09-28 | 删除「接管重试」集成用例 | 与 `main` 上 `local-git-core-provisioning`「恢复供应」同一路径、同一不变量（按总数的工作树、句柄指向同一份、分支唯一），#209 合入后重复；为 P1 修复腾出规模 |
| 2026-09-28 | 取消的 actor / 写尝试、ack 后事务失败的对账、ack 状态核对、结果路径漏报、Storage 规范化登记 #215 | 需要改命令接口或新增对账路径；本 PR 已在代码规模上限 |
| 2026-09-28 | `manualFallback` 开头先读已有运行（第十二轮 P2） | 与「结果不确定不起第二个执行者」同一条：已有运行时主执行可能仍在跑，覆盖它会丢掉唯一的路由引用 |

## Idempotence and Recovery

- 所有验证命令只读、可重复执行；集成用例每条用独立的 `mkdtemp` 仓库并在结束后删除。
- 第十轮改写前建立了恢复锚点：本地分支 `backup/pr161-before-round10` 指向 `0296551`。回到改写前：`git reset --hard backup/pr161-before-round10`（只在本 worktree、确认没有未提交修改之后）。
- 推送使用精确的 `git push --force-with-lease=feat/human-execution-provider:<改写前远端 head>`；远端被他人前移时推送失败，先回读再决定。
- 回滚合并后的变更：按提交**逆序** revert（先 `docs(exec-plan)`，再 `feat(execution)`，最后 `feat(providers)`）。每个提交单独跑是绿的，但 `feat(execution)` 依赖 `feat(providers)` 引入的 `execution.run.fallback`，单独 revert 后者会让 `tsc` 报 `TS2339`（第十一轮评审实测）。迁移 004 未发布，revert 即可。

## Interfaces and Dependencies

- 组装约束：`registerBindings` 在两个绑定共用 binding id 时抛 `TypeError`（组装失败而不是静默覆盖）；只注入 `executionFallback` 时它仍被注册。
- 新增 / 变化的接口：`HumanExecutionProviderOptions.bindingId` 与 `issuerKey` 必需；`CoreCommands.cancelExecutionRun(query)`；`ExecutionRunRecord.providerRef?` / `fallback?`；`CapabilityKey.ExecutionRunFallback`；`CoreProviderTable.executionFallback`。
- 宿主义务（#132 装配时兑现）：从 binding 注册的权威记录取稳定 `bindingId`，从 secret 服务解析 `issuerKey`（只在内存里）；两者重启前后不变。
- 外部工具：`git`（集成用例）、Node 内置 `node:crypto`；不需要网络与凭据。

## Outcomes & Retrospective

- 交付：人工执行 provider（来源可证）、fallback 承接、运行身份落库与按运行身份取消；四条 P2 的根因在同一处（运行身份与签发者身份没有单一权威）收敛。
- #139 的两条验收现在都有判别性证据（契约套件无网络通过；运行经 Storage 重启后逐字段读回且引用可路由），#171 的降级触发点与 #172 的落库、往返断言、ADR 也已交付；三者保持 `Refs`，关闭由人类伙伴决定。
- 与计划的偏差：本层原先把 #171 / #172 划在范围外，第七轮评审后并入；S1 暴露了"整合提交"会静默丢文件——以后整合前后都要 `git diff --stat <旧 head> <新 head>` 核对文件集合。
- 遗留：#215（取消命令的 actor / 写尝试与 controller 暴露、ack 后事务失败的对账、ack 状态核对、两条结果路径漏报、Storage 规范化与往返契约、时钟回拨归因、fallback 的 `isDefault` 断言）；签发密钥轮换（ADR-0008 Consequences）；宿主装配 #132、UI #142、SQLite 前置 #187 / #188 / #196、句柄统一 #206。

## Bottom Change Note

- 2026-09-24：创建；Batch 1–2 与第一至四轮评审响应。
- 2026-09-26：第六轮处置；第七轮两条 P1 并入范围（Batch 3）。
- 2026-09-28：原文件在重排中丢失（S1），按当前事实重建并随 PR #161 归档到 `completed/`；追加 Batch 4、S2–S4、变异 M1–M11 与 ADR-0008。
- 2026-09-28：第十一轮评审响应：追加 Batch 5、S5、变异 M12–M27，D3 / D6 / D8 / D9 就地订正，回滚顺序订正，Batch 1–3 补涉及文件。
- 2026-09-28：第十三轮最终复核响应：Batch 6 追加早返回的订正，最终复测表加 M36、M37 并按最终树重测。
- 2026-09-28：第十二轮复评响应：追加 Batch 6；术语表、最小证据、Batch 1 / 2 的过期原句改为当前事实；两张中间读数的变异表合并为最终复测表（M1–M35，第十三轮加 M36、M37 并全表重测）。
